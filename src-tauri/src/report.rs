//! Error reports: what would leave the device when something fails.
//!
//! A report is built from an allowlist, never from free text: the layer that failed, the kind of
//! failure (a type or class name, or an app-owned code), and the frames of the app's own code that
//! led to it. Messages are never taken — an exception's text can hold a vault path, a file name, a
//! template name or a field value, and none of those may leave the device under any consent.

use serde::Serialize;

/// Where a failure happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Ui,
    Host,
    Shell,
}

/// One error report, exactly as it would be sent.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Report {
    pub layer: Layer,
    pub kind: String,
    pub frames: Vec<String>,
    pub version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
}

impl Report {
    /// A report from what a layer says about a failure. `kind` and `stack` are untrusted: whatever
    /// is not a plain identifier or a frame of the app's own code is dropped.
    pub fn new(layer: Layer, kind: &str, stack: &str) -> Self {
        Report {
            layer,
            kind: plain_kind(kind),
            frames: stack.lines().filter_map(|line| frame(layer, line)).take(MAX_FRAMES).collect(),
            version: env!("CARGO_PKG_VERSION"),
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
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
        Reporter { file, written: Default::default() }
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
            let failure = (report.layer, report.kind.clone(), report.frames.first().cloned());
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
        std::fs::OpenOptions::new().create(true).append(true).open(&self.file)?.write_all(line.as_bytes())
    }
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
    if plain { raw.to_string() } else { "Unrecognized".to_string() }
}

/// A function name as a stack prints it, if it is only an identifier path.
fn function_name(raw: &str) -> Option<&str> {
    let plain = !raw.is_empty()
        && raw.len() <= 200
        && raw.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '$' | '<' | '>'));
    plain.then_some(raw)
}

/// A file's name, if it is a plain ASCII file name with one of `extensions`.
fn source_file<'a>(raw: &'a str, extensions: &[&str]) -> Option<&'a str> {
    let plain = !raw.is_empty() && raw.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
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
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let (host, path) = rest.split_once('/')?;
    let own = host == "tauri.localhost"
        || host.strip_prefix("localhost:").is_some_and(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()));
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
            let function = function.or_else(|| line.split_once('(').map(|(f, _)| f))?;
            let function = function.split('(').next().unwrap_or(function);
            function_name(function).map(str::to_string)
        }
        Layer::Ui => {
            let (url, at) = position(location)?;
            let file = app_path(url)?;
            let file = file.strip_prefix("assets/").or_else(|| file.strip_prefix("src/"))?;
            let file = source_file(file, &[".js", ".mjs", ".ts"])?;
            let function = function.and_then(function_name).unwrap_or("?");
            Some(format!("{function} {file}:{at}"))
        }
        Layer::Shell => {
            let (path, at) = position(location)?;
            let file = path.strip_prefix("src/").or_else(|| path.strip_prefix("src\\"))?;
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
        "C:\\Users", "홍길동", "\\\\?\\", "/home/", "/Users/", "문서/", "회의록", "노트", ".md", "intake@1",
        "intake", "장비", "노트북", "secret",
    ];

    fn assert_clean(report: &Report) {
        let wire = serde_json::to_string(report).unwrap();
        for bad in FORBIDDEN {
            assert!(!wire.contains(bad), "{bad:?} reached the report: {wire}");
        }
        assert!(wire.is_ascii(), "only identifiers and file names of the app's own code: {wire}");
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
        let failure = || Report::new(Layer::Ui, "TypeError", "at save (http://tauri.localhost/assets/index-a.js:1:2)");

        assert!(reporter.record(failure()).unwrap());
        assert!(!reporter.record(failure()).unwrap());
        assert!(reporter.record(Report::new(Layer::Ui, "TypeError", "at open (http://tauri.localhost/assets/index-a.js:9:9)")).unwrap());

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
            reporter.record(Report::new(Layer::Host, &format!("Failure{i}"), "")).unwrap();
        }
        let lines = written(&dir);
        assert_eq!(lines.len(), MAX_REPORTS + 1);
        assert_eq!(lines[MAX_REPORTS]["kind"], "ReportsCapped");
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
            ["LlDocuments.save index-Bx12.js:3:1204", "open index-Bx12.js:9:55", "? vendor-9a.js:1:2"]
        );
    }

    #[test]
    fn keeps_an_app_owned_code_and_a_dotted_type_name() {
        assert_eq!(Report::new(Layer::Ui, "outside-vault", "").kind, "outside-vault");
        assert_eq!(
            Report::new(Layer::Host, "Formbase.Core.Errors.ProjectionUnavailableException", "").kind,
            "Formbase.Core.Errors.ProjectionUnavailableException"
        );
    }

    #[test]
    fn a_kind_that_is_not_an_identifier_is_not_kept_in_part() {
        for raw in ["intake@1", "IOException: 문서/a.md", "", "a b"] {
            assert_eq!(Report::new(Layer::Ui, raw, "").kind, "Unrecognized", "{raw:?}");
        }
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
