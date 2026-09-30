mod host;
mod report;
mod vault;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_kit_watch::{ChangeKind, Notice, Watch, Watcher};

use host::{HostState, HostStatus};
use vault::{
    Entry, Vault, VaultError, DOCUMENTS_DIR, DOCUMENT_SUFFIX, TEMPLATES_DIR, TEMPLATE_SUFFIX,
};

/// The open vault and the watch on it. The shell is the only place that touches files.
#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<Watcher>>,
}

/// What a command failure looks like to the UI.
#[derive(Debug, Serialize)]
struct CommandError {
    kind: &'static str,
    message: String,
}

impl From<VaultError> for CommandError {
    fn from(e: VaultError) -> Self {
        CommandError {
            kind: e.kind(),
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

fn no_vault() -> CommandError {
    CommandError {
        kind: "no-vault",
        message: "no vault is open".into(),
    }
}

fn with_vault<T>(
    state: &State<AppState>,
    f: impl FnOnce(&Vault) -> vault::Result<T>,
) -> CommandResult<T> {
    let guard = state.vault.lock().expect("vault state poisoned");
    let vault = guard.as_ref().ok_or_else(no_vault)?;
    Ok(f(vault)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    root: String,
    name: String,
    templates_dir: &'static str,
    documents_dir: &'static str,
}

#[tauri::command]
fn open_vault(path: String, app: AppHandle, state: State<AppState>) -> CommandResult<VaultInfo> {
    let vault = Vault::open(&PathBuf::from(&path))?;
    let root = vault.root();
    let info = VaultInfo {
        root: root.display().to_string(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        templates_dir: TEMPLATES_DIR,
        documents_dir: DOCUMENTS_DIR,
    };
    // The previous vault's watch stops before the next one starts.
    state.watcher.lock().expect("watch state poisoned").take();
    let watcher = watch_vault(&app, &vault)
        .inspect_err(|e| {
            eprintln!("the vault is not watched, outside edits show on the next read: {e}")
        })
        .ok();
    *state.vault.lock().expect("vault state poisoned") = Some(vault);
    *state.watcher.lock().expect("watch state poisoned") = watcher;
    Ok(info)
}

/// Whether a folder holds nothing: a new vault is made only in an empty one, so nobody's files end up
/// beside the sample the app puts there.
#[tauri::command]
fn folder_is_empty(path: String) -> CommandResult<bool> {
    Ok(std::fs::read_dir(&path)
        .map_err(VaultError::from)?
        .next()
        .is_none())
}

/// Where the app keeps files of its own in a vault that are not the user's: probe files of the
/// watch. Nothing in it is reported.
const TMP_DIR: &str = ".lowline/tmp";

/// How often the watch checks that it still hears the vault.
const PROBE_EVERY: Duration = Duration::from_secs(300);

/// What changed in the vault, as the UI is told: paths relative to the vault, `/`-separated.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct VaultChanged {
    /// Changes were lost: everything shown may be stale and is read again.
    rescan: bool,
    written: Vec<String>,
    removed: Vec<String>,
}

impl From<Notice> for VaultChanged {
    fn from(notice: Notice) -> Self {
        let mut changed = VaultChanged {
            rescan: false,
            written: Vec::new(),
            removed: Vec::new(),
        };
        match notice {
            Notice::Rescan => changed.rescan = true,
            Notice::Changed(changes) => {
                for change in changes {
                    let path = slashed(&change.path);
                    match change.kind {
                        ChangeKind::Written => changed.written.push(path),
                        ChangeKind::Removed => changed.removed.push(path),
                    }
                }
            }
        }
        changed
    }
}

fn slashed(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Whether a change at `rel` is none of the app's business. The vault folder may be shared with
/// other programs — another notes app keeps its own files there, a sync client its state — and
/// only the places the app reads count: templates, documents and other devices' event files. This
/// device's event file is appended to by this app alone, and its temporary files are its own.
fn ignored(rel: &Path, own_events: Option<&Path>) -> bool {
    let read = [TEMPLATES_DIR, DOCUMENTS_DIR, EVENTS_DIR];
    !read.iter().any(|dir| rel.starts_with(dir)) || own_events == Some(rel)
}

/// Watches the vault for edits made outside the app — another editor, a sync client, another
/// device — and tells the UI. This app's own writes are left out, and so is this device's event
/// file, which only this app appends to.
fn watch_vault(app: &AppHandle, vault: &Vault) -> std::io::Result<Watcher> {
    let _ = tauri_kit_fs::sweep_staging(&vault.root().join(TMP_DIR), Duration::from_secs(3600));
    let own_events = device_id(app)
        .ok()
        .map(|d| PathBuf::from(format!("{EVENTS_DIR}/{d}.jsonl")));
    let app = app.clone();
    Watch::new(vault.root())
        .own_writes(vault.own_writes())
        .ignore(move |rel| ignored(rel, own_events.as_deref()))
        .probe_liveness(TMP_DIR, PROBE_EVERY)
        .start(move |notice| {
            let _ = app.emit("vault-changed", VaultChanged::from(notice));
        })
}

#[tauri::command]
fn list_templates(state: State<AppState>) -> CommandResult<Vec<Entry>> {
    with_vault(&state, |v| v.list(TEMPLATES_DIR, TEMPLATE_SUFFIX))
}

#[tauri::command]
fn list_documents(state: State<AppState>) -> CommandResult<Vec<Entry>> {
    with_vault(&state, |v| v.list(DOCUMENTS_DIR, DOCUMENT_SUFFIX))
}

#[tauri::command]
fn read_file(path: String, state: State<AppState>) -> CommandResult<String> {
    with_vault(&state, |v| v.read(&path))
}

/// Reads several files in one call: a full read of the vault would otherwise cross into the shell
/// once per file. A file removed since it was listed comes back as `null`.
#[tauri::command]
fn read_files(paths: Vec<String>, state: State<AppState>) -> CommandResult<Vec<Option<String>>> {
    with_vault(&state, |v| v.read_many(&paths))
}

/// Replaces a file atomically.
#[tauri::command]
fn write_file(path: String, content: String, state: State<AppState>) -> CommandResult<()> {
    with_vault(&state, |v| v.write(&path, &content))
}

/// Creates a file atomically; fails with `already-exists` rather than replace one.
#[tauri::command]
fn create_file(path: String, content: String, state: State<AppState>) -> CommandResult<()> {
    with_vault(&state, |v| v.create(&path, &content))
}

/// Gives a file another name in its folder; fails with `already-exists` rather than replace one.
#[tauri::command]
fn rename_file(from: String, to: String, state: State<AppState>) -> CommandResult<()> {
    with_vault(&state, |v| v.rename(&from, &to))
}

/// Moves a file to the system's trash; fails with `not-trashed`, leaving it, where there is none.
#[tauri::command]
fn trash_file(path: String, state: State<AppState>) -> CommandResult<()> {
    with_vault(&state, |v| v.trash(&path))
}

/// Deletes a file for good — once the person has chosen that for a file the trash would not take.
#[tauri::command]
fn remove_file(path: String, state: State<AppState>) -> CommandResult<()> {
    with_vault(&state, |v| v.remove(&path))
}

/// Where this install's events go: one append-only file per device, so vaults shared through a
/// sync service never have two devices writing the same file.
const EVENTS_DIR: &str = ".lowline/events";

/// Appends one suggestion event (accept, correct or reject) to this device's event file in the vault.
#[tauri::command]
fn record_event(
    event: serde_json::Value,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> CommandResult<()> {
    if !event.is_object() {
        return Err(CommandError {
            kind: "io",
            message: "an event is a JSON object".into(),
        });
    }
    let device = device_id(&app).map_err(|e| CommandError {
        kind: "io",
        message: e.to_string(),
    })?;
    let line = event.to_string();
    with_vault(&state, |v| {
        v.append_line(&format!("{EVENTS_DIR}/{device}.jsonl"), &line)
    })
}

/// Every device's event file in the vault: what suggestions have learned was wrong.
#[tauri::command]
fn list_events(state: State<AppState>) -> CommandResult<Vec<Entry>> {
    with_vault(&state, |v| v.list(EVENTS_DIR, ".jsonl"))
}

/// Where this device keeps the suggestions it has shown, one file per vault. Outside the vault: they
/// are counted, never learned from, and a draft let go leaves nothing of itself in a shared vault.
fn presentations_file(app: &tauri::AppHandle, root: &Path) -> std::io::Result<PathBuf> {
    let dir = app.path().app_local_data_dir().map_err(std::io::Error::other)?;
    let name = format!("{:016x}.jsonl", fnv1a(root.to_string_lossy().as_bytes()));
    Ok(dir.join("presentations").join(name))
}

/// FNV-1a: a name for a vault that stays the same from one build to the next, which std's hasher
/// does not promise.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn io_error(e: std::io::Error) -> CommandError {
    CommandError {
        kind: "io",
        message: e.to_string(),
    }
}

/// Appends one suggestion shown to this device's record of them for the open vault.
#[tauri::command]
fn record_presentation(
    presentation: serde_json::Value,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> CommandResult<()> {
    if !presentation.is_object() {
        return Err(CommandError {
            kind: "io",
            message: "a presentation is a JSON object".into(),
        });
    }
    let root = with_vault(&state, |v| Ok(v.root().to_path_buf()))?;
    let file = presentations_file(&app, &root).map_err(io_error)?;
    append_line(&file, &presentation.to_string()).map_err(io_error)
}

fn append_line(file: &Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file)?;
    f.write_all(format!("{line}
").as_bytes())
}

/// This device's record of the suggestions it has shown for the open vault; empty before the first.
#[tauri::command]
fn read_presentations(app: tauri::AppHandle, state: State<AppState>) -> CommandResult<String> {
    let root = with_vault(&state, |v| Ok(v.root().to_path_buf()))?;
    let file = presentations_file(&app, &root).map_err(io_error)?;
    match std::fs::read_to_string(&file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        other => other.map_err(io_error),
    }
}

/// This install's id, made on first use and kept outside any vault.
fn device_id(app: &tauri::AppHandle) -> std::io::Result<String> {
    let dir = app.path().app_config_dir().map_err(std::io::Error::other)?;
    let path = dir.join("device-id");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    );
    std::fs::create_dir_all(&dir)?;
    tauri_kit_fs::write_atomic_new(&path, id.as_bytes()).or_else(|e| match e.kind() {
        // Another window made it first: use theirs.
        std::io::ErrorKind::AlreadyExists => Ok(()),
        _ => Err(e),
    })?;
    Ok(std::fs::read_to_string(&path)?.trim().to_string())
}

/// Whether the sidecar is starting, ready, or failed to start.
#[tauri::command]
fn host_status(state: State<HostState>) -> HostStatus {
    state.status()
}

/// Hands the sidecar a snapshot of the open vault, as the UI parsed it. Returns what it changed.
#[tauri::command]
async fn host_ingest(
    snapshot: serde_json::Value,
    vault: State<'_, AppState>,
    state: State<'_, HostState>,
) -> Result<serde_json::Value, String> {
    let path = {
        let guard = vault.vault.lock().expect("vault state poisoned");
        ingest_path(guard.as_ref().ok_or("no vault is open")?.root())
    };
    let client = state.client()?;
    let body = snapshot.to_string();
    host_json(
        blocking(move || {
            // What the last ingest's background work failed at is reported before the next one.
            report_host_failures(client.take_failures());
            client.post_json(&path, &body)
        })
        .await?,
    )
}

/// The ingest request for the vault at `root`: the sidecar keeps one projection cache per vault.
fn ingest_path(root: &Path) -> String {
    format!("/vault/ingest?vault={}", encode_segment(&root.to_string_lossy()))
}

/// A template's documents as a table.
#[tauri::command]
async fn host_projection(
    template: String,
    state: State<'_, HostState>,
) -> Result<serde_json::Value, String> {
    let client = state.client()?;
    let path = format!("/projection/{}", encode_segment(&template));
    host_json(blocking(move || client.get(&path)).await?)
}

/// How the suggestions of each judgment field have fared, from the vault's event files.
#[tauri::command]
async fn host_curves(state: State<'_, HostState>) -> Result<serde_json::Value, String> {
    let client = state.client()?;
    host_json(blocking(move || client.get("/curves")).await?)
}

/// Runs a request to the sidecar off the async runtime.
async fn blocking(
    request: impl FnOnce() -> Result<String, host::CallError> + Send + 'static,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(request)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            if let host::CallError::Failed(failure) = &e {
                report(report::Report::new(report::Layer::Host, &failure.kind, &failure.frames.join("\n")));
            }
            e.to_string()
        })
}

/// A suggestion for one judgment field of a document being filled in.
#[tauri::command]
async fn host_suggest(
    request: serde_json::Value,
    state: State<'_, HostState>,
) -> Result<serde_json::Value, String> {
    let client = state.client()?;
    let body = request.to_string();
    host_json(blocking(move || client.post_json("/suggest", &body)).await?)
}

fn host_json(body: String) -> Result<serde_json::Value, String> {
    serde_json::from_str(&body)
        .map_err(|e| format!("the sidecar answered with something else than JSON: {e}"))
}

/// Percent-encodes everything outside the unreserved set (and `@`), so a template id is one segment.
fn encode_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'@' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Starts the sidecar off the main thread, so the window opens while it starts.
fn start_host(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let result = (|| {
            let exe = host::executable(&app.path().resource_dir().map_err(|e| e.to_string())?);
            let log = app
                .path()
                .app_log_dir()
                .map_err(|e| e.to_string())?
                .join("host.stderr.log");
            // Projection caches are this device's, outside any vault, and can always be rebuilt.
            let cache = app
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?
                .join("projections");
            host::Host::start(&exe, log, &cache)
        })();
        if result.is_err() {
            // Why it failed is a message, and messages do not leave the device: the kind says enough.
            report(report::Report::new(report::Layer::Host, "HostStartFailed", ""));
        }
        app.state::<HostState>().set(result);
    });
}

/// This launch's error reports. Set once the log folder is known; a failure before that is not
/// reported.
static REPORTER: std::sync::OnceLock<report::Reporter> = std::sync::OnceLock::new();

/// Writes an error report to `reports.jsonl` in the log folder — what is sent, for anyone to read.
/// A build made with a sink sends it on the next launch.
fn report(report: report::Report) {
    if let Some(reporter) = REPORTER.get() {
        let _ = reporter.record(report);
    }
}

/// Reports what the sidecar failed at away from any request.
fn report_host_failures(failures: Vec<host::HostFailure>) {
    for failure in failures {
        report(report::Report::new(report::Layer::Host, &failure.kind, &failure.frames.join("\n")));
    }
}

/// A failure the UI caught: its kind (an error's class name or an app-owned code) and stack. Only
/// what the report keeps of them is written.
#[tauri::command]
fn report_error(kind: String, stack: String) {
    report(report::Report::new(report::Layer::Ui, &kind, &stack));
}

/// Starts writing error reports, and reports a panic of the shell — to disk only, from the panic
/// itself: a panicking process is no place to send anything.
fn start_reports(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let file = dir.join("reports.jsonl");
    if REPORTER.set(report::Reporter::new(file.clone())).is_err() {
        return;
    }
    // What earlier launches wrote goes out now, away from startup; what fails stays for the next.
    if let Some(sink) = report::Sink::of_build() {
        std::thread::spawn(move || {
            let _ = sink.send_pending(&report::Sink::agent(), &file, &dir.join("reports.sent"));
        });
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        report(report::Report::new(report::Layer::Shell, "Panic", &at));
        previous(info);
    }));
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(HostState::default())
        .setup(|app| {
            start_reports(app.handle());
            start_host(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            folder_is_empty,
            list_templates,
            list_documents,
            read_file,
            read_files,
            write_file,
            create_file,
            rename_file,
            trash_file,
            remove_file,
            host_status,
            host_ingest,
            host_projection,
            host_curves,
            host_suggest,
            report_error,
            record_event,
            list_events,
            record_presentation,
            read_presentations
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lowline")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Ok(client) = app.state::<HostState>().client() {
                    report_host_failures(client.take_failures());
                }
                app.state::<HostState>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_kit_watch::Change;

    #[test]
    fn watches_only_the_places_the_app_reads() {
        let own = Path::new(".lowline/events/this-device.jsonl");
        for rel in ["서식/버그 리포트.fd.md", "문서/2026-09-29 제목.md", ".lowline/events/other-device.jsonl"] {
            assert!(!ignored(Path::new(rel), Some(own)), "{rel} is read by the app");
        }
        for rel in [
            ".lowline/events/this-device.jsonl",
            ".lowline/tmp/.tauri-kit-tmp-1",
            ".textree/tmp/.watcher-canary-3",
            ".textree/favorites.json",
            "메모.md",
            "assets/Pasted-1.png",
            "문서철/a.md",
        ] {
            assert!(ignored(Path::new(rel), Some(own)), "{rel} is not the app's to read");
        }
    }

    #[test]
    fn a_template_id_stays_one_path_segment() {
        assert_eq!(encode_segment("bug-report@1"), "bug-report@1");
        assert_eq!(
            encode_segment("상담/기록 1"),
            "%EC%83%81%EB%8B%B4%2F%EA%B8%B0%EB%A1%9D%201"
        );
    }

    #[test]
    fn an_ingest_names_the_vault_it_is_for() {
        assert_eq!(
            ingest_path(Path::new("D:/볼트 1")),
            "/vault/ingest?vault=D%3A%2F%EB%B3%BC%ED%8A%B8%201"
        );
    }

    #[test]
    fn a_change_reaches_the_ui_with_vault_paths() {
        let changed = VaultChanged::from(Notice::Changed(vec![
            Change {
                path: Path::new("문서").join("a.md"),
                kind: ChangeKind::Written,
            },
            Change {
                path: PathBuf::from("서식/b.fd.md"),
                kind: ChangeKind::Removed,
            },
        ]));
        assert_eq!(changed.written, vec!["문서/a.md"]);
        assert_eq!(changed.removed, vec!["서식/b.fd.md"]);
        assert!(!changed.rescan);
        assert!(VaultChanged::from(Notice::Rescan).rescan);
    }

    #[test]
    fn names_a_vault_the_same_way_every_build() {
        // FNV-1a's published test vectors: a changed name would orphan every device's record.
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn appends_presentations_line_by_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("presentations").join("v.jsonl");
        append_line(&file, r#"{"a":1}"#).unwrap();
        append_line(&file, r#"{"a":2}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"a\":1}
{\"a\":2}
");
    }
}
