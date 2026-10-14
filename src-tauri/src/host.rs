//! The .NET sidecar: started with the app, stopped with it.
//!
//! The shell starts `host/Lowline.Host` from its resources as a loopback sidecar
//! (`tauri_kit_sidecar::loopback`): a fresh token in `LOWLINE_HOST_TOKEN`, the directory for its
//! projection caches in `LOWLINE_HOST_CACHE`. The host listens on a loopback port the OS picks and
//! prints one line with it; every request carries the token. The sidecar never touches vault files —
//! the shell hands it what it needs.
//!
//! A sidecar that ends during the session is started again, a few times at most: the next request or
//! status check finds it gone (`Sidecar::is_running`), and asks for the host to be launched again. What
//! the sidecar held is the vault the UI handed it, so the UI hands it over again once it is back.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri_kit_sidecar::loopback::{
    Client, Fault, Loopback, LoopbackOptions, Response, TransportError,
};

/// Must match `HostAuth.TokenVariable` in `src-host/Lowline.Host`.
pub const TOKEN_VARIABLE: &str = "LOWLINE_HOST_TOKEN";
/// Must match `VaultProjection.CacheVariable` in `src-host/Lowline.Host`.
pub const CACHE_VARIABLE: &str = "LOWLINE_HOST_CACHE";
/// Must match `ReadyLine.Prefix` in `src-host/Lowline.Host`.
const READY_PREFIX: &str = "lowline-host port=";
const START_DEADLINE: Duration = Duration::from_secs(30);
/// How many times a sidecar that ended is started again in one session, before it is said to have failed.
const MAX_RESTARTS: u32 = 3;
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

/// Why a request to the host did not come back with an answer.
#[derive(Debug)]
pub enum CallError {
    /// The host failed the request and said what failed.
    Failed(Fault),
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
pub fn answer(response: Response) -> Result<String, CallError> {
    if response.is_success() {
        return Ok(response.body);
    }
    Err(response
        .fault()
        .map_or(CallError::Status(response.status), CallError::Failed))
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

    /// Whether the host's process still runs.
    fn is_running(&mut self) -> bool {
        self.sidecar.sidecar().is_running()
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
        answer(response)
    }

    /// A POST request with a JSON body, returning the response body.
    pub fn post_json(&self, path: &str, body: &str) -> Result<String, CallError> {
        let response = self.client.post_json(path, body)?;
        answer(response)
    }

    /// The host's failures of work no request waited on, since the last time they were taken.
    pub fn take_failures(&self) -> Vec<Fault> {
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

/// Launches the host in the background; `true` when it is started again after it ended.
type Launch = Box<dyn Fn(bool) + Send + Sync>;

/// The host, once started, and its status.
#[derive(Default)]
pub struct HostState {
    pub host: Mutex<Option<Host>>,
    pub status: Mutex<Option<HostStatus>>,
    launch: OnceLock<Launch>,
    restarts: AtomicU32,
    /// Stopped for good — the app ends, or an update is about to replace the sidecar: never started again.
    stopped: AtomicBool,
}

impl HostState {
    /// Launches the host with `launch`, which is kept to launch it again if it ends.
    pub fn launch_with(&self, launch: impl Fn(bool) + Send + Sync + 'static) {
        if self.launch.set(Box::new(launch)).is_ok() {
            (self.launch.get().expect("just set"))(false);
        }
    }

    pub fn status(&self) -> HostStatus {
        self.find_ended();
        self.status
            .lock()
            .expect("host status poisoned")
            .clone()
            .unwrap_or(HostStatus::Starting)
    }

    /// When the running host has ended, lets it go and launches it again — or, after it has ended too
    /// often, says it failed. Nothing is launched once the host was stopped for good.
    fn find_ended(&self) {
        {
            let mut host = self.host.lock().expect("host poisoned");
            if !host.as_mut().is_some_and(|running| !running.is_running()) {
                return;
            }
            *host = None;
        }
        if self.stopped.load(Ordering::SeqCst) {
            return;
        }
        let ended = self.restarts.fetch_add(1, Ordering::SeqCst) + 1;
        let status = if ended > MAX_RESTARTS {
            HostStatus::Failed {
                message: format!("the sidecar ended {ended} times"),
            }
        } else {
            HostStatus::Starting
        };
        let again = matches!(status, HostStatus::Starting);
        *self.status.lock().expect("host status poisoned") = Some(status);
        if again {
            if let Some(launch) = self.launch.get() {
                launch(true);
            }
        }
    }

    pub fn set(&self, result: Result<Host, String>) {
        let status = match result {
            // Started while the app was stopping it for good: it does not stay.
            Ok(host) if self.stopped.load(Ordering::SeqCst) => {
                host.stop();
                return;
            }
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
        self.find_ended();
        // The lock is let go before asking the status, which takes it again: held across that call — as a
        // `match` on the guard holds it — the thread waits on itself for good, and every later caller with it.
        let running = self
            .host
            .lock()
            .expect("host poisoned")
            .as_ref()
            .map(|host| host.client.clone());
        running.ok_or_else(|| match self.status() {
            HostStatus::Failed { message } => message,
            _ => "the sidecar is still starting".into(),
        })
    }

    /// Stops the host if it runs, for good. Called when the app exits, and before an update replaces it.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
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

    fn reply(status: u16, body: &str) -> Response {
        Response {
            status,
            body: body.into(),
        }
    }

    #[test]
    fn an_answer_is_its_body_when_the_request_succeeded() {
        assert_eq!(answer(reply(200, "{}")).unwrap(), "{}");
    }

    #[test]
    fn a_failed_request_says_what_failed_when_the_host_said() {
        let failed = answer(reply(
            500,
            r#"{"fault":{"type":"System.ArgumentException","at":"Lowline.Host.VaultProjection.IngestAsync","frames":["Lowline.Host.VaultProjection.IngestAsync"]}}"#,
        ));
        match failed {
            Err(CallError::Failed(f)) => {
                assert_eq!(f.kind, "System.ArgumentException");
                assert_eq!(f.frames, ["Lowline.Host.VaultProjection.IngestAsync"]);
            }
            other => panic!("{other:?}"),
        }
    }

    /// `f` on its own thread, failing the test should it not have returned within a few seconds.
    fn returns_soon<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (done, answer) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(f());
        });
        answer
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("it waited on itself")
    }

    #[test]
    fn a_request_while_the_sidecar_starts_says_so_and_leaves_the_state_usable() {
        let state = std::sync::Arc::new(HostState::default());
        let starting = state.clone();
        let said = returns_soon(move || starting.client().err());
        assert_eq!(said.as_deref(), Some("the sidecar is still starting"));
        // Nothing stays held: the status, asked on another thread as the window asks it, still answers.
        let asked = state.clone();
        assert!(matches!(
            returns_soon(move || asked.status()),
            HostStatus::Starting
        ));
    }

    #[test]
    fn a_request_once_starting_failed_says_why() {
        let state = std::sync::Arc::new(HostState::default());
        state.set(Err("the host did not start".into()));
        let failed = state.clone();
        assert_eq!(
            returns_soon(move || failed.client().err()).as_deref(),
            Some("the host did not start")
        );
    }

    #[test]
    fn any_other_failure_is_only_its_status() {
        assert!(matches!(
            answer(reply(500, "")),
            Err(CallError::Status(500))
        ));
        assert!(matches!(
            answer(reply(404, "")),
            Err(CallError::Status(404))
        ));
    }
}
