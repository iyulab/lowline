# Lowline

> **Looking for the Lowline desktop app?** Its source code is at
> [iyulab/lowline-desktop](https://github.com/iyulab/lowline-desktop), and its installers at
> [iyulab/lowline-releases](https://github.com/iyulab/lowline-releases/releases/latest).

Lowline is a form engine that learns from the records people confirm. A host app puts a form on
screen; the engine suggests values for its fields from the records already confirmed, says how often
such a suggestion has been right, and learns from what the person accepts, corrects or turns down.
Nothing is saved until a person confirms it.

Status: early development — no package is published yet.

## What is here

| Part | What it does |
|---|---|
| [`crates/lowline`](crates/lowline) | The core, in Rust with no I/O: the form in one shape whatever it was written in (formdown read from its schema), which of its fields are decided, per-field suggestion policy, and the account of what a person did with each suggestion while writing a record — taken, changed, turned down, or typed with nothing in view — turned into the settlements a decider learns from. With the `gil` feature, the form and its settlements in the vocabulary of the [Gil](https://crates.io/crates/iyulab-gil) decider, and an engine that keeps one form's decider between calls — records learned, fields answered, saves settled, thresholds chosen again when they no longer stand — leaving the host only to store what it hands back. Builds for WebAssembly, so a browser and a server count the same way. |
| [`crates/lowline-ffi`](crates/lowline-ffi) | A C ABI over the engine, one handle per form, everything as JSON — the native side of a .NET host. Not published on its own. |

Coming next: the .NET host over the C ABI, and a form element.

## Development

```sh
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

## License

[MIT](LICENSE)
