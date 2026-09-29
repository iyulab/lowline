//! The .NET sidecar: started with the app, stopped with it.
//!
//! The shell starts `host/Lowline.Host` from its resources with a fresh token in
//! `LOWLINE_HOST_TOKEN` and the directory for its projection caches in `LOWLINE_HOST_CACHE`. The host listens on a loopback port the OS picks and prints one line with
//! its address; every request carries the token. The sidecar never touches vault files — the
//! shell hands it what it needs.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri_kit_sidecar::{LineReadiness, Output, Sidecar};

pub const TOKEN_VARIABLE: &str = "LOWLINE_HOST_TOKEN";
/// Must match `VaultProjection.CacheVariable` in `src-host/Lowline.Host`.
pub const CACHE_VARIABLE: &str = "LOWLINE_HOST_CACHE";
/// Must match `ReadyLine.Prefix` in `src-host/Lowline.Host`.
const READY_PREFIX: &str = "lowline-host listening ";
const START_DEADLINE: Duration = Duration::from_secs(30);
const STOP_GRACE: Duration = Duration::from_secs(3);

/// A running host and how to reach it.
pub struct Host {
    sidecar: Sidecar,
    client: HostClient,
}

/// How to reach the host: its address and this launch's token. Cheap to clone into a worker thread.
#[derive(Clone)]
pub struct HostClient {
    base: String,
    token: String,
}

impl Host {
    /// Starts the host at `exe`, keeping its projection caches in `cache`, and waits until it has
    /// said where it listens and answered `/health`.
    pub fn start(exe: &Path, stderr_log: PathBuf, cache: &Path) -> Result<Self, String> {
        let token = new_token().map_err(|e| format!("cannot make a token: {e}"))?;
        let mut cmd = Command::new(exe);
        cmd.env(TOKEN_VARIABLE, &token).env(CACHE_VARIABLE, cache);
        let mut sidecar = Sidecar::spawn(
            cmd,
            Output::Lines {
                stderr: Some(stderr_log),
            },
        )
        .map_err(|e| format!("cannot start {}: {e}", exe.display()))?;
        let base = match sidecar
            .wait_line(START_DEADLINE, |line| line.starts_with(READY_PREFIX))
            .map_err(|e| format!("cannot read the host's output: {e}"))?
        {
            LineReadiness::Line(line) => {
                line[READY_PREFIX.len()..].trim_end_matches('/').to_string()
            }
            LineReadiness::Exited(status) => {
                return Err(format!("the host exited during startup ({status})"))
            }
            LineReadiness::TimedOut => {
                let _ = sidecar.shutdown(Duration::ZERO);
                return Err(format!(
                    "the host did not start within {}s",
                    START_DEADLINE.as_secs()
                ));
            }
        };
        let host = Host {
            sidecar,
            client: HostClient { base, token },
        };
        host.client
            .get("/health")
            .map_err(|e| format!("the host does not answer: {e}"))?;
        Ok(host)
    }

    /// Asks the host to stop, then stops whatever is left of it.
    pub fn stop(self) {
        let _ = ureq::post(&format!("{}/shutdown", self.client.base))
            .header("Authorization", &self.client.bearer())
            .send_empty();
        let _ = self.sidecar.shutdown(STOP_GRACE);
    }
}

impl HostClient {
    /// A GET request to the host, returning the response body.
    pub fn get(&self, path: &str) -> Result<String, ureq::Error> {
        ureq::get(&format!("{}{}", self.base, path))
            .header("Authorization", &self.bearer())
            .call()?
            .body_mut()
            .read_to_string()
    }

    /// A POST request with a JSON body, returning the response body.
    pub fn post_json(&self, path: &str, body: &str) -> Result<String, ureq::Error> {
        ureq::post(&format!("{}{}", self.base, path))
            .header("Authorization", &self.bearer())
            .header("Content-Type", "application/json")
            .send(body)?
            .body_mut()
            .read_to_string()
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.token)
    }
}

/// 32 random bytes as hex.
fn new_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Where the host stands, as the UI sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum HostStatus {
    Starting,
    Ready,
    Failed { message: String },
}

/// The host, once started, and its status.
#[derive(Default)]
pub struct HostState {
    pub host: Mutex<Option<Host>>,
    pub status: Mutex<Option<HostStatus>>,
}

impl HostState {
    pub fn status(&self) -> HostStatus {
        self.status
            .lock()
            .expect("host status poisoned")
            .clone()
            .unwrap_or(HostStatus::Starting)
    }

    pub fn set(&self, result: Result<Host, String>) {
        let status = match result {
            Ok(host) => {
                *self.host.lock().expect("host poisoned") = Some(host);
                HostStatus::Ready
            }
            Err(message) => HostStatus::Failed { message },
        };
        *self.status.lock().expect("host status poisoned") = Some(status);
    }

    /// A client for the running host, or why there is none.
    pub fn client(&self) -> Result<HostClient, String> {
        match self.host.lock().expect("host poisoned").as_ref() {
            Some(host) => Ok(host.client.clone()),
            None => Err(match self.status() {
                HostStatus::Failed { message } => message,
                _ => "the sidecar is still starting".into(),
            }),
        }
    }

    /// Stops the host if it runs. Called when the app exits.
    pub fn stop(&self) {
        if let Some(host) = self.host.lock().expect("host poisoned").take() {
            host.stop();
        }
    }
}

/// The host executable inside the app's resources.
pub fn executable(resource_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "Lowline.Host.exe"
    } else {
        "Lowline.Host"
    };
    resource_dir.join("host").join(name)
}
