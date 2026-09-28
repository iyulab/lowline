mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use vault::{Entry, Vault, VaultError, DOCUMENTS_DIR, DOCUMENT_SUFFIX, TEMPLATES_DIR, TEMPLATE_SUFFIX};

/// The open vault. The shell is the only place that touches files.
#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
}

/// What a command failure looks like to the UI.
#[derive(Debug, Serialize)]
struct CommandError {
    kind: &'static str,
    message: String,
}

impl From<VaultError> for CommandError {
    fn from(e: VaultError) -> Self {
        CommandError { kind: e.kind(), message: e.to_string() }
    }
}

type CommandResult<T> = Result<T, CommandError>;

fn no_vault() -> CommandError {
    CommandError { kind: "no-vault", message: "no vault is open".into() }
}

fn with_vault<T>(state: &State<AppState>, f: impl FnOnce(&Vault) -> vault::Result<T>) -> CommandResult<T> {
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
fn open_vault(path: String, state: State<AppState>) -> CommandResult<VaultInfo> {
    let vault = Vault::open(&PathBuf::from(&path))?;
    let root = vault.root();
    let info = VaultInfo {
        root: root.display().to_string(),
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        templates_dir: TEMPLATES_DIR,
        documents_dir: DOCUMENTS_DIR,
    };
    *state.vault.lock().expect("vault state poisoned") = Some(vault);
    Ok(info)
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            list_templates,
            list_documents,
            read_file,
            write_file,
            create_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lowline");
}
