//! Error reports: the parts of this app that fail on their own, and where their reports go.
//!
//! What a report holds — the layer, the kind, the frames of the app's own code, never a message —
//! is `tauri-kit-diagnostics`'s promise; this module names the layers and the build's sink.

use std::sync::LazyLock;

use tauri_kit_diagnostics::FrameRule;
pub use tauri_kit_diagnostics::{trim, Report, Reporter, Sink, MAX_FILE_BYTES};

/// Where a failure happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    /// The web UI, served from the app's bundle.
    Ui,
    /// The .NET sidecar: method names only — file names in .NET stacks are the build machine's.
    Host,
    /// This crate's Rust code.
    Shell,
}

static UI: LazyLock<tauri_kit_diagnostics::Layer> =
    LazyLock::new(|| tauri_kit_diagnostics::Layer::new("ui", FrameRule::web_bundle()));
static HOST: LazyLock<tauri_kit_diagnostics::Layer> =
    LazyLock::new(|| tauri_kit_diagnostics::Layer::new("host", FrameRule::dotnet_method()));
static SHELL: LazyLock<tauri_kit_diagnostics::Layer> =
    LazyLock::new(|| tauri_kit_diagnostics::Layer::new("shell", FrameRule::rust_source()));

impl Layer {
    fn rules(self) -> &'static tauri_kit_diagnostics::Layer {
        match self {
            Layer::Ui => &UI,
            Layer::Host => &HOST,
            Layer::Shell => &SHELL,
        }
    }
}

/// A report from what a layer says about a failure. `kind` and `stack` are untrusted: whatever is
/// not a plain identifier or a frame of the app's own code is dropped.
pub fn new(layer: Layer, kind: &str, stack: &str) -> Report {
    Report::new(layer.rules(), kind, stack, env!("CARGO_PKG_VERSION"))
}

/// The sink this build was made with. A build made without one — every development and test
/// build — sends nothing.
pub fn sink_of_build() -> Option<Sink> {
    option_env!("LOWLINE_APPINSIGHTS_CONNECTION_STRING").and_then(Sink::parse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layers_keep_the_names_earlier_reports_were_written_with() {
        for (layer, name) in [
            (Layer::Ui, "ui"),
            (Layer::Host, "host"),
            (Layer::Shell, "shell"),
        ] {
            assert_eq!(new(layer, "Panic", "").layer, name);
        }
    }

    #[test]
    fn each_layer_keeps_only_its_own_frames() {
        let ui = new(
            Layer::Ui,
            "TypeError",
            "TypeError: C:\\Users\\someone\\a.md\n    at save (http://tauri.localhost/assets/index-a1.js:3:120)",
        );
        assert_eq!(ui.frames, ["save index-a1.js:3:120"]);
        let shell = new(Layer::Shell, "Panic", "src/vault.rs:42:9");
        assert_eq!(shell.frames, ["vault.rs:42:9"]);
        let host = new(
            Layer::Host,
            "IOException",
            "at Lowline.Host.Vault.Read(String path) in D:\\build\\Vault.cs:line 12",
        );
        assert_eq!(host.frames, ["Lowline.Host.Vault.Read"]);
        assert_eq!(ui.version, env!("CARGO_PKG_VERSION"));
    }
}
