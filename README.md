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
| [`crates/lowline`](crates/lowline) | The core, in Rust with no I/O: the form in one shape whatever it was written in (formdown read from its schema), which of its fields are decided, per-field suggestion policy, and the account of what a person did with each suggestion while writing a record — taken, changed, turned down, or typed with nothing in view — turned into the settlements a decider learns from. With the `gil` feature, the form and its settlements in the vocabulary of the [Gil](https://crates.io/crates/iyulab-gil) decider, and an engine that keeps one form's decider between calls — records learned, fields answered, saves settled, thresholds chosen again when they no longer stand — leaving the host only to store what it hands back. Builds for WebAssembly too. |
| [`crates/lowline-ffi`](crates/lowline-ffi) | A C ABI over the engine, one handle per form, everything as JSON — the native side of a .NET host. Not published on its own. |
| [`bindings/csharp`](bindings/csharp) | The .NET host: an engine per form and memory space over the store the host keeps its records in (`ILowlineStore`, or SQLite with `Lowline.Sqlite`), proposing and settling through the C ABI; `Lowline.AspNetCore` puts it behind two routes with `AddLowline` and `MapLowline`. Not packed yet. |
| [`bindings/web`](bindings/web) | `<lowline-form>`: a formdown form whose decided fields are suggested through those routes; it keeps the account of what was shown and done and sends it with the save. Not published yet. |

[`samples/aspnet`](samples/aspnet) puts the three together — `AddLowline(o => o.UseSqlite(…))`, `MapLowline("/lowline")` and
`<lowline-form>` on a page — and seeds forty records so the owner of a known customer is suggested at once:

```sh
cargo build -p lowline-ffi
(cd bindings/web && npm ci && npm run bundle)
dotnet run --project samples/aspnet
```

Coming next: filling fields from free text or a picture.

## Development

```sh
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo build -p lowline-ffi && (cd bindings/csharp && dotnet test --solution Lowline.slnx)
(cd bindings/web && npm ci && npm test)
```

## License

[MIT](LICENSE)
