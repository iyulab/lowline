//! The .NET sidecar: started with the app, stopped with it.
//!
//! The shell starts `host/Lowline.Host` from its resources as a loopback sidecar
//! (`tauri_kit_sidecar::loopback`): a fresh token in `LOWLINE_HOST_TOKEN`, the directory for its
//! projection caches in `LOWLINE_HOST_CACHE`. The host listens on a loopback port the OS picks and
//! prints one line with it; every request carries the token. The sidecar never touches vault files —
//! the shell hands it what it needs.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri_kit_sidecar::loopback::{Client, Loopback, LoopbackOptions, TransportError};

/// Must match `HostAuth.TokenVariable` in `src-host/Lowline.Host`.
pub const TOKEN_VARIABLE: &str = "LOWLINE_HOST_TOKEN";
/// Must match `VaultProjection.CacheVariable` in `src-host/Lowline.Host`.
pub const CACHE_VARIABLE: &str = "LOWLINE_HOST_CACHE";
/// Must match `ReadyLine.Prefix` in `src-host/Lowline.Host`.
const READY_PREFIX: &str = "lowline-host port=";
const START_DEADLINE: Duration = Duration::from_secs(30);
const STOP_GRACE: Duration = Duration::from_secs(3);

/// A running host and how to reach it.
pub struct Host {
    sidecar: Loopback,
    client: HostClient,
}

/// How to reach the host: its port and this launch's token. Cheap to clone into a worker thread.
#[derive(Clone)]
pub struct HostClient {
    client: Client,
}

// TODO(upstream: tauri-kit-sidecar `Response::fault` / `Fault`, pushed after 0.9.1 and not yet
// published) — once a release carries them, `HostFailure` is `tauri_kit_sidecar::loopback::Fault`,
// `answer` takes the `Response` and reads `response.fault()`, and `FaultAnswer` goes.
/// A request the host failed: what the host said about it, when it said something — the
/// exception's type and the methods it passed through (TauriKit.Sidecar.Loopback's `FaultView`).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct HostFailure {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub frames: Vec<String>,
}

/// The body of a request the host failed: `{"fault":{…}}`.
#[derive(serde::Deserialize)]
struct FaultAnswer {
    fault: HostFailure,
}

/// Why a request to the host did not come back with an answer.
#[derive(Debug)]
pub enum CallError {
    /// The host failed the request and said what failed.
    Failed(HostFailure),
    /// The host answered with this status and nothing more to go on.
    Status(u16),
    /// The request did not reach the host, or its answer could not be read.
    Transport(TransportError),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CallError::Failed(failure) => write!(f, "the sidecar failed: {}", failure.kind),
            CallError::Status(status) => write!(f, "the sidecar answered {status}"),
            CallError::Transport(e) => write!(f, "{e}"),
        }
    }
}

impl From<TransportError> for CallError {
    fn from(e: TransportError) -> Self {
        CallError::Transport(e)
    }
}

/// An answer by its status: the body when it succeeded; otherwise what failed, if the host said.
pub fn answer(status: u16, body: String) -> Result<String, CallError> {
    match status {
        200..=299 => Ok(body),
        500 => Err(serde_json::from_str::<FaultAnswer>(&body)
            .map_or(CallError::Status(500), |a| CallError::Failed(a.fault))),
        _ => Err(CallError::Status(status)),
    }
}

impl Host {
    /// Starts the host at `exe`, keeping its projection caches in `cache`, and waits until it has
    /// said where it listens and answered `/health`.
    pub fn start(exe: &Path, stderr_log: PathBuf, cache: &Path) -> Result<Self, String> {
        let mut cmd = Command::new(exe);
        cmd.env(CACHE_VARIABLE, cache);
        let mut options = LoopbackOptions::new(TOKEN_VARIABLE, READY_PREFIX);
        options.ready_timeout = START_DEADLINE;
        options.stderr = Some(stderr_log);
        let sidecar =
            Loopback::start(cmd, &options).map_err(|e| format!("the host did not start: {e}"))?;
        let client = HostClient {
            client: sidecar.client().clone(),
        };
        let host = Host { sidecar, client };
        host.client
            .get("/health")
            .map_err(|e| format!("the host does not answer: {e}"))?;
        Ok(host)
    }

    /// Asks the host to stop, then stops whatever is left of it.
    pub fn stop(self) {
        let _ = self.client.client.post_json("/shutdown", "");
        let _ = self.sidecar.shutdown(STOP_GRACE);
    }
}

impl HostClient {
    /// A GET request to the host, returning the response body.
    pub fn get(&self, path: &str) -> Result<String, CallError> {
        let response = self.client.get(path)?;
        answer(response.status, response.body)
    }

    /// A POST request with a JSON body, returning the response body.
    pub fn post_json(&self, path: &str, body: &str) -> Result<String, CallError> {
        let response = self.client.post_json(path, body)?;
        answer(response.status, response.body)
    }

    /// The host's failures of work no request waited on, since the last time they were taken.
    pub fn take_failures(&self) -> Vec<HostFailure> {
        self.post_json("/failures/take", "")
            .ok()
            .and_then(|body| serde_json::from_str(&body).ok())
            .unwrap_or_default()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answer_is_its_body_when_the_request_succeeded() {
        assert_eq!(answer(200, "{}".into()).unwrap(), "{}");
    }

    #[test]
    fn a_failed_request_says_what_failed_when_the_host_said() {
        let failed = answer(500, r#"{"fault":{"type":"System.ArgumentException","at":"Lowline.Host.VaultProjection.IngestAsync","frames":["Lowline.Host.VaultProjection.IngestAsync"]}}"#.into());
        match failed {
            Err(CallError::Failed(f)) => {
                assert_eq!(f.kind, "System.ArgumentException");
                assert_eq!(f.frames, ["Lowline.Host.VaultProjection.IngestAsync"]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn any_other_failure_is_only_its_status() {
        assert!(matches!(
            answer(500, "".into()),
            Err(CallError::Status(500))
        ));
        assert!(matches!(
            answer(404, "".into()),
            Err(CallError::Status(404))
        ));
    }
}
