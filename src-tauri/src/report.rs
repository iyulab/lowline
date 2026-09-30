//! Error reports: what would leave the device when something fails.
//!
//! A report is built from an allowlist, never from free text: the layer that failed, the kind of
//! failure (a type or class name, or an app-owned code), and the frames of the app's own code that
//! led to it. Messages are never taken — an exception's text can hold a vault path, a file name, a
//! template name or a field value, and none of those may leave the device under any consent.

use serde::{Deserialize, Serialize};

/// Where a failure happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Ui,
    Host,
    Shell,
}

/// One error report, exactly as it is sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub layer: Layer,
    pub kind: String,
    pub frames: Vec<String>,
    pub version: String,
    pub os: String,
    pub arch: String,
    /// When it failed, in UTC to the second — reports are sent on a later launch.
    pub time: String,
}

impl Report {
    /// A report from what a layer says about a failure. `kind` and `stack` are untrusted: whatever
    /// is not a plain identifier or a frame of the app's own code is dropped.
    pub fn new(layer: Layer, kind: &str, stack: &str) -> Self {
        Report {
            layer,
            kind: plain_kind(kind),
            frames: stack
                .lines()
                .filter_map(|line| frame(layer, line))
                .take(MAX_FRAMES)
                .collect(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            time: utc(std::time::SystemTime::now()),
        }
    }
}

/// The reports of one launch, written where the person can read them — exactly what would be sent.
/// Each failure is written once, and a launch writes at most [`MAX_REPORTS`].
pub struct Reporter {
    file: std::path::PathBuf,
    written: std::sync::Mutex<Written>,
}

/// What a launch has written: which failures, and how many reports.
#[derive(Default)]
struct Written {
    failures: std::collections::HashSet<(Layer, String, Option<String>)>,
    count: usize,
}

/// A launch that fails this often is failing the same way; more reports would say nothing new.
pub const MAX_REPORTS: usize = 50;

impl Reporter {
    pub fn new(file: std::path::PathBuf) -> Self {
        Reporter {
            file,
            written: Default::default(),
        }
    }

    /// Writes the report unless this failure — the same layer, kind and first frame — was written
    /// already in this launch. Past [`MAX_REPORTS`], one last report says the rest were left out.
    /// Returns whether it was written.
    pub fn record(&self, report: Report) -> std::io::Result<bool> {
        let mut written = self.written.lock().unwrap_or_else(|e| e.into_inner());
        if written.count > MAX_REPORTS {
            return Ok(false);
        }
        let report = if written.count == MAX_REPORTS {
            Report::new(report.layer, "ReportsCapped", "")
        } else {
            let failure = (
                report.layer,
                report.kind.clone(),
                report.frames.first().cloned(),
            );
            if !written.failures.insert(failure) {
                return Ok(false);
            }
            report
        };
        self.append(&report)?;
        written.count += 1;
        Ok(true)
    }

    fn append(&self, report: &Report) -> std::io::Result<()> {
        use std::io::Write;
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut line = serde_json::to_string(report).map_err(std::io::Error::other)?;
        line.push('\n');
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file)?
            .write_all(line.as_bytes())
    }
}

/// Where reports go: an Application Insights resource, named by its connection string.
#[derive(Debug, Clone, PartialEq)]
pub struct Sink {
    pub instrumentation_key: String,
    /// The ingestion endpoint's track URL.
    pub track_url: String,
}

impl Sink {
    /// The sink a connection string names, if it names one.
    pub fn parse(connection_string: &str) -> Option<Self> {
        let field = |name: &str| {
            connection_string
                .split(';')
                .find_map(|part| part.trim().strip_prefix(name)?.strip_prefix('='))
                .filter(|value| !value.is_empty())
        };
        let key = field("InstrumentationKey")?;
        let endpoint = field("IngestionEndpoint").filter(|e| e.starts_with("https://"))?;
        Some(Sink {
            instrumentation_key: key.to_string(),
            track_url: format!("{}/v2.1/track", endpoint.trim_end_matches('/')),
        })
    }

    /// The sink this build was made with. A build made without one — every development and test
    /// build — sends nothing.
    pub fn of_build() -> Option<Self> {
        option_env!("LOWLINE_APPINSIGHTS_CONNECTION_STRING").and_then(Self::parse)
    }

    /// A report as Application Insights takes it: one exception telemetry item, whose type and
    /// message are both the report's kind and whose stack is the report's frames.
    pub fn envelope(&self, report: &Report) -> serde_json::Value {
        serde_json::json!({
            "name": "Microsoft.ApplicationInsights.Exception",
            "time": report.time,
            "iKey": self.instrumentation_key,
            "tags": {
                "ai.cloud.role": report.layer,
                "ai.application.ver": report.version,
                "ai.device.osVersion": format!("{} {}", report.os, report.arch),
            },
            "data": {
                "baseType": "ExceptionData",
                "baseData": {
                    "ver": 2,
                    "exceptions": [{
                        "typeName": report.kind,
                        "message": report.kind,
                        "hasFullStack": false,
                        "stack": report.frames.join("\n"),
                    }],
                    "severityLevel": 3,
                },
            },
        })
    }
}

/// How many reports go out in one request.
const BATCH: usize = 100;

impl Sink {
    /// An agent for the ingestion endpoint: the OS's TLS and certificate store, and the proxy the
    /// PC is set up with — an office network that inspects TLS has its own root in that store.
    pub fn agent() -> ureq::Agent {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        ureq::Agent::config_builder()
            .tls_config(tls)
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_secs(30)))
            .build()
            .into()
    }

    /// Sends the reports `file` has gained since the last send, and records in `sent` how far into
    /// `file` has been sent. A line that is not a report (one written before reports had a time) is
    /// passed over. Stops at the first request that fails for a reason that may pass — the network,
    /// or the endpoint being busy or down — and leaves the rest for the next launch. Returns how
    /// many reports were sent.
    pub fn send_pending(
        &self,
        agent: &ureq::Agent,
        file: &std::path::Path,
        sent: &std::path::Path,
    ) -> std::io::Result<usize> {
        use std::io::{Read, Seek};
        let mut pending = match std::fs::File::open(file) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e),
        };
        let len = usize::try_from(pending.metadata()?.len()).map_err(std::io::Error::other)?;
        // A file shorter than what was sent is a new file: the old one was deleted.
        let mut offset = std::fs::read_to_string(sent)
            .ok()
            .and_then(|s| s.trim().parse::<usize>().ok())
            .filter(|&offset| offset <= len)
            .unwrap_or(0);
        // Only what follows what was sent is read: the file is kept, so it only grows.
        pending.seek(std::io::SeekFrom::Start(offset as u64))?;
        let mut bytes = Vec::new();
        pending.read_to_end(&mut bytes)?;
        // Only whole lines: a launch may still be writing the last one.
        let end = bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let lines: Vec<&[u8]> = bytes[..end].split_inclusive(|&b| b == b'\n').collect();
        let mut count = 0;
        for batch in lines.chunks(BATCH) {
            let reports: Vec<Report> = batch
                .iter()
                .filter_map(|line| serde_json::from_slice(line).ok())
                .collect();
            if !reports.is_empty() {
                let items: Vec<_> = reports.iter().map(|report| self.envelope(report)).collect();
                let body = serde_json::to_vec(&items).map_err(std::io::Error::other)?;
                let status = agent
                    .post(&self.track_url)
                    .header("Content-Type", "application/json")
                    .send(&body[..])
                    .map_err(std::io::Error::other)?
                    .status()
                    .as_u16();
                // Busy, throttled or down: the same reports may be taken later.
                if matches!(status, 408 | 429) || status >= 500 {
                    return Err(std::io::Error::other(format!(
                        "the endpoint answered {status}"
                    )));
                }
                // Anything else was taken, or will never be: either way it is not sent again.
                if (200..300).contains(&status) {
                    count += reports.len();
                }
            }
            offset += batch.iter().map(|line| line.len()).sum::<usize>();
            std::fs::write(sent, offset.to_string())?;
        }
        Ok(count)
    }
}

/// `time` as ISO 8601 in UTC, to the second.
fn utc(at: std::time::SystemTime) -> String {
    let secs = at
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Days since the epoch to a civil date (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// Enough of a stack to tell one failure from another.
const MAX_FRAMES: usize = 20;

/// A type or class name, or an app-owned code — whole, or not at all: a kind that is not a plain
/// identifier may be text from anywhere, and a part of it is still that text.
fn plain_kind(raw: &str) -> String {
    let mut chars = raw.chars();
    let plain = raw.len() <= 100
        && chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'));
    if plain {
        raw.to_string()
    } else {
        "Unrecognized".to_string()
    }
}

/// A function name as a stack prints it, if it is only an identifier path.
fn function_name(raw: &str) -> Option<&str> {
    let plain = !raw.is_empty()
        && raw.len() <= 200
        && raw.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '$' | '<' | '>' | '+' | '`')
        });
    plain.then_some(raw)
}

/// A file's name, if it is a plain ASCII file name with one of `extensions`.
fn source_file<'a>(raw: &'a str, extensions: &[&str]) -> Option<&'a str> {
    let plain = !raw.is_empty()
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    (plain && extensions.iter().any(|ext| raw.ends_with(ext))).then_some(raw)
}

/// `file:line:col` split into the file and `line:col` (digits only).
fn position(location: &str) -> Option<(&str, &str)> {
    let (rest, col) = location.rsplit_once(':')?;
    let (file, line) = rest.rsplit_once(':')?;
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    (digits(line) && digits(col)).then(|| (file, &location[file.len() + 1..]))
}

/// The path of a script the app itself serves — from its bundle, or the dev server while developing.
fn app_path(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let (host, path) = rest.split_once('/')?;
    let own = host == "tauri.localhost"
        || host
            .strip_prefix("localhost:")
            .is_some_and(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()));
    own.then_some(path)
}

/// One frame of the app's own code, or nothing.
///
/// - UI: a script served from the app's bundle — `function file.js:line:col`.
/// - Shell: a source file of this crate — `file.rs:line:col`; frames of other crates are dropped.
/// - Host: the method name only; file names in .NET stacks are the build machine's paths.
fn frame(layer: Layer, line: &str) -> Option<String> {
    let line = line.trim();
    let line = line.strip_prefix("at ").unwrap_or(line);
    let line = line.strip_prefix("async ").unwrap_or(line);
    let (function, location) = match line.rsplit_once(" (") {
        Some((function, rest)) if rest.ends_with(')') => (Some(function), &rest[..rest.len() - 1]),
        _ => match line.split_once(" in ") {
            Some((function, _)) => (Some(function), ""),
            None => (None, line),
        },
    };
    match layer {
        Layer::Host => {
            // `Type.Method` as the host lists it, or `Type.Method(args) in file:line N` as .NET prints it.
            let function = function.unwrap_or(line);
            let function = function.split('(').next().unwrap_or(function);
            function_name(function).map(str::to_string)
        }
        Layer::Ui => {
            let (url, at) = position(location)?;
            let file = app_path(url)?;
            let file = file
                .strip_prefix("assets/")
                .or_else(|| file.strip_prefix("src/"))?;
            let file = source_file(file, &[".js", ".mjs", ".ts"])?;
            let function = function.and_then(function_name).unwrap_or("?");
            Some(format!("{function} {file}:{at}"))
        }
        Layer::Shell => {
            let (path, at) = position(location)?;
            let file = path
                .strip_prefix("src/")
                .or_else(|| path.strip_prefix("src\\"))?;
            let file = source_file(file, &[".rs"])?;
            Some(format!("{file}:{at}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Strings no report may carry, whatever a layer hands over: vault paths (Windows, the `\\?\`
    /// form, POSIX, vault-relative), file names, template references, field values, a user name.
    const FORBIDDEN: &[&str] = &[
        "C:\\Users",
        "홍길동",
        "\\\\?\\",
        "/home/",
        "/Users/",
        "문서/",
        "회의록",
        "노트",
        ".md",
        "intake@1",
        "intake",
        "장비",
        "노트북",
        "secret",
    ];

    fn assert_clean(report: &Report) {
        let wire = serde_json::to_string(report).unwrap();
        for bad in FORBIDDEN {
            assert!(!wire.contains(bad), "{bad:?} reached the report: {wire}");
        }
        assert!(
            wire.is_ascii(),
            "only identifiers and file names of the app's own code: {wire}"
        );
    }

    fn written(dir: &tempfile::TempDir) -> Vec<serde_json::Value> {
        std::fs::read_to_string(dir.path().join("reports.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn writes_each_failure_once_a_launch() {
        let dir = tempfile::tempdir().unwrap();
        let reporter = Reporter::new(dir.path().join("reports.jsonl"));
        let failure = || {
            Report::new(
                Layer::Ui,
                "TypeError",
                "at save (http://tauri.localhost/assets/index-a.js:1:2)",
            )
        };

        assert!(reporter.record(failure()).unwrap());
        assert!(!reporter.record(failure()).unwrap());
        assert!(reporter
            .record(Report::new(
                Layer::Ui,
                "TypeError",
                "at open (http://tauri.localhost/assets/index-a.js:9:9)"
            ))
            .unwrap());

        let lines = written(&dir);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["layer"], "ui");
        assert_eq!(lines[0]["kind"], "TypeError");
        assert_eq!(lines[0]["frames"][0], "save index-a.js:1:2");
    }

    #[test]
    fn says_once_when_a_launch_has_reported_enough() {
        let dir = tempfile::tempdir().unwrap();
        let reporter = Reporter::new(dir.path().join("reports.jsonl"));
        for i in 0..MAX_REPORTS + 10 {
            reporter
                .record(Report::new(Layer::Host, &format!("Failure{i}"), ""))
                .unwrap();
        }
        let lines = written(&dir);
        assert_eq!(lines.len(), MAX_REPORTS + 1);
        assert_eq!(lines[MAX_REPORTS]["kind"], "ReportsCapped");
    }

    #[test]
    fn reads_the_sink_from_a_connection_string() {
        let sink = Sink::parse(
            "InstrumentationKey=00000000-1111-2222-3333-444444444444;IngestionEndpoint=https://koreacentral-0.in.applicationinsights.azure.com/;LiveEndpoint=https://live/;ApplicationId=x",
        )
        .unwrap();
        assert_eq!(
            sink.instrumentation_key,
            "00000000-1111-2222-3333-444444444444"
        );
        assert_eq!(
            sink.track_url,
            "https://koreacentral-0.in.applicationinsights.azure.com/v2.1/track"
        );
    }

    #[test]
    fn a_connection_string_without_a_key_or_an_https_endpoint_names_no_sink() {
        assert_eq!(Sink::parse(""), None);
        assert_eq!(Sink::parse("IngestionEndpoint=https://x/"), None);
        assert_eq!(
            Sink::parse("InstrumentationKey=k;IngestionEndpoint=http://x/"),
            None
        );
        assert_eq!(
            Sink::parse("InstrumentationKey=;IngestionEndpoint=https://x/"),
            None
        );
    }

    #[test]
    fn a_report_goes_out_as_one_exception_item() {
        let sink = Sink {
            instrumentation_key: "k".into(),
            track_url: "https://x/v2.1/track".into(),
        };
        let mut report = Report::new(
            Layer::Ui,
            "TypeError",
            "at save (http://tauri.localhost/assets/index-a.js:1:2)",
        );
        report.time = "2026-09-29T09:26:31Z".into();
        let item = sink.envelope(&report);
        assert_eq!(item["name"], "Microsoft.ApplicationInsights.Exception");
        assert_eq!(item["time"], "2026-09-29T09:26:31Z");
        assert_eq!(item["iKey"], "k");
        assert_eq!(item["tags"]["ai.cloud.role"], "ui");
        assert_eq!(item["data"]["baseType"], "ExceptionData");
        let exception = &item["data"]["baseData"]["exceptions"][0];
        assert_eq!(exception["typeName"], "TypeError");
        assert_eq!(exception["message"], "TypeError");
        assert_eq!(exception["stack"], "save index-a.js:1:2");
        // Still nothing but the report: the envelope adds no field that could carry content.
        assert!(item.to_string().is_ascii());
    }

    /// A loopback endpoint that answers each request with the next of `statuses`, and hands back
    /// the bodies it was sent.
    fn endpoint(statuses: Vec<u16>) -> (Sink, std::thread::JoinHandle<Vec<serde_json::Value>>) {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let sink = Sink {
            instrumentation_key: "k".into(),
            track_url: format!("http://{}/v2.1/track", listener.local_addr().unwrap()),
        };
        let server = std::thread::spawn(move || {
            let mut bodies = Vec::new();
            for status in statuses {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream);
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse().unwrap();
                        }
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                bodies.push(serde_json::from_slice(&body).unwrap());
                let answer = format!(
                    "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                reader.into_inner().write_all(answer.as_bytes()).unwrap();
            }
            bodies
        });
        (sink, server)
    }

    fn loopback() -> ureq::Agent {
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .proxy(None)
            .build()
            .into()
    }

    #[test]
    fn sends_what_was_written_since_the_last_send() {
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        let reporter = Reporter::new(file.clone());
        reporter
            .record(Report::new(Layer::Ui, "TypeError", ""))
            .unwrap();
        reporter
            .record(Report::new(Layer::Host, "System.IOException", ""))
            .unwrap();

        let (sink, server) = endpoint(vec![200]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 2);
        let bodies = server.join().unwrap();
        let items = bodies[0].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0]["data"]["baseData"]["exceptions"][0]["typeName"],
            "TypeError"
        );
        assert_eq!(items[1]["tags"]["ai.cloud.role"], "host");

        // Nothing new: no request at all.
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 0);

        // Only what came after.
        reporter
            .record(Report::new(Layer::Shell, "Panic", ""))
            .unwrap();
        let (sink, server) = endpoint(vec![200]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 1);
        assert_eq!(
            server.join().unwrap()[0][0]["data"]["baseData"]["exceptions"][0]["typeName"],
            "Panic"
        );
    }

    #[test]
    fn keeps_the_reports_for_later_when_the_endpoint_is_busy() {
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        Reporter::new(file.clone())
            .record(Report::new(Layer::Ui, "TypeError", ""))
            .unwrap();

        let (sink, server) = endpoint(vec![503]);
        assert!(sink.send_pending(&loopback(), &file, &sent).is_err());
        server.join().unwrap();

        let (sink, server) = endpoint(vec![200]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 1);
        server.join().unwrap();
    }

    #[test]
    fn does_not_send_again_what_the_endpoint_will_never_take() {
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        Reporter::new(file.clone())
            .record(Report::new(Layer::Ui, "TypeError", ""))
            .unwrap();

        let (sink, server) = endpoint(vec![400]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 0);
        server.join().unwrap();
        // The line counts as handled: a second send makes no request.
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 0);
    }

    #[test]
    fn passes_over_lines_that_are_not_reports_and_a_line_still_being_written() {
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        let old = r#"{"layer":"ui","kind":"TypeError","frames":[],"version":"0.1.0","os":"windows","arch":"x86_64"}"#;
        let report = serde_json::to_string(&Report::new(Layer::Ui, "RangeError", "")).unwrap();
        std::fs::write(&file, format!("{old}\n{report}\n{{\"layer\":\"ui\"")).unwrap();

        let (sink, server) = endpoint(vec![200]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 1);
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0].as_array().unwrap().len(), 1);
        assert_eq!(
            std::fs::read_to_string(&sent).unwrap(),
            (old.len() + 1 + report.len() + 1).to_string()
        );
    }

    #[test]
    fn a_new_file_shorter_than_what_was_sent_is_sent_from_its_start() {
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        std::fs::write(&sent, "999999").unwrap();
        Reporter::new(file.clone())
            .record(Report::new(Layer::Ui, "TypeError", ""))
            .unwrap();

        let (sink, server) = endpoint(vec![200]);
        assert_eq!(sink.send_pending(&loopback(), &file, &sent).unwrap(), 1);
        server.join().unwrap();
    }

    /// Sends one report to a real resource over HTTPS — the OS's TLS and certificate store. Run by
    /// hand with the connection string in the environment:
    /// `LOWLINE_APPINSIGHTS_CONNECTION_STRING=… cargo test -- --ignored reaches_the_ingestion_endpoint`
    #[test]
    #[ignore]
    fn reaches_the_ingestion_endpoint() {
        let sink =
            Sink::parse(&std::env::var("LOWLINE_APPINSIGHTS_CONNECTION_STRING").unwrap()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let (file, sent) = (
            dir.path().join("reports.jsonl"),
            dir.path().join("reports.sent"),
        );
        Reporter::new(file.clone())
            .record(Report::new(Layer::Shell, "EnvelopeProbe", ""))
            .unwrap();
        assert_eq!(sink.send_pending(&Sink::agent(), &file, &sent).unwrap(), 1);
    }

    #[test]
    fn writes_utc_time() {
        let at = |s| std::time::UNIX_EPOCH + std::time::Duration::from_secs(s);
        assert_eq!(utc(at(0)), "1970-01-01T00:00:00Z");
        assert_eq!(utc(at(951_782_400)), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn no_field_can_carry_a_vault_path_template_ref_field_value_or_file_name() {
        let corpus = [
            ("Error", "at open (C:\\Users\\홍길동\\볼트\\문서\\회의록.md:1:1)"),
            ("IOException: C:\\Users\\홍길동\\볼트\\문서\\2026-09-29 회의록.md", ""),
            ("Error", "at read (\\\\?\\C:\\Users\\홍길동\\볼트\\노트\\a.md:3:9)"),
            ("Error", "at read (/home/홍길동/볼트/노트/a.md:3:9)\n    at x (/Users/kim/볼트/문서/b.md:1:1)"),
            ("intake@1", "at suggest (http://tauri.localhost/문서/회의록.md:2:2)"),
            ("RecordKeyException 문서/회의록.md", "at Formbase.Core.Accept(RecordKey key) in 노트/회의록.md:line 3"),
            ("{\"요청\":\"노트북 배터리\",\"담당\":\"장비\"}", "{\"secret\":1}"),
            ("Error", "at open (http://tauri.localhost/assets/노트/회의록.md:1:1)"),
        ];
        for (kind, stack) in corpus {
            for layer in [Layer::Ui, Layer::Host, Layer::Shell] {
                assert_clean(&Report::new(layer, kind, stack));
            }
        }
    }

    #[test]
    fn keeps_a_plain_kind_and_the_frames_of_the_apps_own_bundle() {
        let report = Report::new(
            Layer::Ui,
            "TypeError",
            "TypeError: x is undefined\n    at LlDocuments.save (http://tauri.localhost/assets/index-Bx12.js:3:1204)\n    at async open (http://tauri.localhost/assets/index-Bx12.js:9:55)\n    at http://tauri.localhost/assets/vendor-9a.js:1:2",
        );
        assert_eq!(report.kind, "TypeError");
        assert_eq!(
            report.frames,
            [
                "LlDocuments.save index-Bx12.js:3:1204",
                "open index-Bx12.js:9:55",
                "? vendor-9a.js:1:2"
            ]
        );
    }

    #[test]
    fn keeps_an_app_owned_code_and_a_dotted_type_name() {
        assert_eq!(
            Report::new(Layer::Ui, "outside-vault", "").kind,
            "outside-vault"
        );
        assert_eq!(
            Report::new(
                Layer::Host,
                "Formbase.Core.Errors.ProjectionUnavailableException",
                ""
            )
            .kind,
            "Formbase.Core.Errors.ProjectionUnavailableException"
        );
    }

    #[test]
    fn a_kind_that_is_not_an_identifier_is_not_kept_in_part() {
        for raw in ["intake@1", "IOException: 문서/a.md", "", "a b"] {
            assert_eq!(
                Report::new(Layer::Ui, raw, "").kind,
                "Unrecognized",
                "{raw:?}"
            );
        }
    }

    #[test]
    fn keeps_the_method_names_a_host_failure_lists() {
        let report = Report::new(
            Layer::Host,
            "System.ArgumentException",
            "Lowline.Host.VaultProjection.IngestAsync
Lowline.Host.VaultProjection+<IngestAsync>d__12.MoveNext
문서/회의록.md",
        );
        assert_eq!(
            report.frames,
            [
                "Lowline.Host.VaultProjection.IngestAsync",
                "Lowline.Host.VaultProjection+<IngestAsync>d__12.MoveNext"
            ]
        );
    }

    #[test]
    fn keeps_a_shell_frame_only_from_the_apps_own_source() {
        let report = Report::new(
            Layer::Shell,
            "Panic",
            "src\\host.rs:120:9\nC:\\Users\\kim\\.cargo\\registry\\src\\ureq-3.0\\src\\lib.rs:5:1\nsrc/vault.rs:88:13",
        );
        assert_eq!(report.frames, ["host.rs:120:9", "vault.rs:88:13"]);
    }
}
