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
| [`bindings/csharp`](bindings/csharp) | The .NET host: an engine per form and memory space over the store the host keeps its records in (`ILowlineStore`, or SQLite with `Lowline.Sqlite`), proposing and settling through the C ABI; `Lowline.AspNetCore` puts it behind its routes with `AddLowline` and `MapLowline`. NuGet: `Lowline` (with the native library for Windows, Linux and macOS, x64 and arm64), `Lowline.Sqlite`, `Lowline.AspNetCore`. |
| [`bindings/web`](bindings/web) | `<lowline-form>`: a formdown form whose decided fields are suggested through those routes; it keeps the account of what was shown and done and sends it with the save. npm: `@iyulab/lowline-form`. |

## Using it

A web host writes two pieces on the server and one on the page.

```csharp
builder.Services.AddLowline(o => o
    .UseSqlite("Data Source=lowline.db")       // where the confirmed records are kept
    .Form("intake", intakeDefinition));        // the form: its fields, as JSON or as formdown's getSchema()
app.MapLowline("/lowline");                    // POST /lowline/{form}/propose · settle · fill · judge
```

```html
<lowline-form src="/lowline" form="intake" record="r-17"></lowline-form>
```

Set the element's `content` to the form's formdown text. While a record is written, the element asks what to show
for the fields the engine decides, draws each suggestion in its field with what it rests on, and keeps the account of
what the person took, changed or turned down; `save()` sends it with the values, and the engine learns from it. The
host decides, per request, the memory space a record belongs to (`Space` — a workplace, a team; records of one space
never answer for another) and the choices its person may pick (`Allowed`) — a value outside them is never suggested.
Authentication and authorization stay the host's.

Filling from what a person wrote is on when the host gives its model (`UseModel` with an `ILowlineModel`): the engine
tells the model which fields are still empty and what each may hold, checks what comes back, and offers each value
in its field for the person to take — never put in on its own, and never counted as the records' own answer.

The same model judges what the records cannot answer yet — a decided field of a record unlike any confirmed before.
Such a field asks for a judgement and says which of the record's values to read; the element asks the host, the host
puts it to the model (`ILowlineModel.JudgeAsync`), and the model's value is offered back to the engine, which shows it
as its own answer when the model trusts it and it is one of the field's choices. A judgement is shown, never put in on
its own; taken by a person, it counts as the engine's answer, so the engine learns how often its judgements hold. Where
the records have evidence, a judgement changes nothing.

[`samples/aspnet`](samples/aspnet) is all of it on one page, with a stand-in model, seeding forty records so the
owner of a known customer is suggested at once:

```sh
cargo build -p lowline-ffi
(cd bindings/web && npm ci && npm run bundle)
dotnet run --project samples/aspnet
```

## Development

```sh
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo build -p lowline-ffi && (cd bindings/csharp && dotnet test --solution Lowline.slnx)
(cd bindings/web && npm ci && npm test)
```

## Releasing

Everything here shares one version: the crates, the three .NET packages and the form element.

1. `npx @iyulab/tauri-kit-dev versions --config versions.config.js --bump <version>`, and move the changelog's
   `[Unreleased]` under that version.
2. Commit, tag `v<version>`, push the tag. The `Release` workflow builds the native library for six runtimes (Windows,
   Linux and macOS, x64 and arm64), packs `Lowline` with them, restores the packages on three systems and calls into
   the library, then publishes to NuGet and npm.
3. From the tag: `cargo publish -p lowline`.

Running `Release` by hand without `publish` does all but the publishing — a trial of the packages.

## License

[MIT](LICENSE)
