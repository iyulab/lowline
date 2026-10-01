//! Updates: whether a newer release is out, and installing it once the person says so.
//!
//! The check reads one public file (the release's `latest.json`); nothing of the vault goes with it.
//! An update is installed only when asked, and only with a valid update signature — the updater
//! refuses anything else. A development build checks only where `LOWLINE_UPDATE_ENDPOINT` points.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

/// The update the last check found, kept for installing it.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<Update>>);

/// A newer release, as the UI shows it.
#[derive(Debug, Serialize)]
pub struct Available {
    pub version: String,
    pub notes: Option<String>,
}

/// What a failed check or install looks like to the UI. Being offline is an expected answer, not a
/// failure of the app: it is never reported.
#[derive(Debug, Serialize)]
pub struct UpdateError {
    kind: &'static str,
    message: String,
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        UpdateError {
            kind: "update",
            message: e.to_string(),
        }
    }
}

/// Where a development build looks for updates; it looks nowhere without it.
const DEV_ENDPOINT: &str = "LOWLINE_UPDATE_ENDPOINT";

/// The updater, or none for a development build that was given no place to look. Before the
/// installer takes over, the sidecar is stopped: the installer replaces its program, which a running
/// sidecar holds open.
fn updater(app: &AppHandle) -> Result<Option<Updater>, UpdateError> {
    let mut builder = app.updater_builder();
    if cfg!(debug_assertions) {
        let Some(endpoint) = std::env::var(DEV_ENDPOINT).ok().filter(|e| !e.is_empty()) else {
            return Ok(None);
        };
        let url = endpoint.parse::<Url>().map_err(|e| UpdateError {
            kind: "update",
            message: e.to_string(),
        })?;
        builder = builder.endpoints(vec![url])?;
    }
    let handle = app.clone();
    let updater = builder
        .on_before_exit(move || crate::stop_host(&handle))
        .build()?;
    Ok(Some(updater))
}

/// Whether a newer release is out.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<Available>, UpdateError> {
    let Some(updater) = updater(&app)? else {
        return Ok(None);
    };
    let update = updater.check().await?;
    let available = update.as_ref().map(|u| Available {
        version: u.version.clone(),
        notes: u.body.clone(),
    });
    *state.0.lock().expect("update state poisoned") = update;
    Ok(available)
}

/// Downloads the update the last check found, installs it and starts the new release. On Windows
/// the installer ends the app itself.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), UpdateError> {
    let update = state.0.lock().expect("update state poisoned").take();
    let Some(update) = update else {
        return Err(UpdateError {
            kind: "no-update",
            message: "no update to install".into(),
        });
    };
    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart()
}
