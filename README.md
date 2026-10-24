# Lowline

> **Looking for the Lowline desktop app?** Its source code is at
> [iyulab/lowline-desktop](https://github.com/iyulab/lowline-desktop), and its installers at
> [iyulab/lowline-releases](https://github.com/iyulab/lowline-releases/releases/latest).

Lowline is a form engine that learns from the records people confirm. A host app puts a form on
screen; the engine suggests values for its fields from the records already confirmed, says how often
such a suggestion has been right, and learns from what the person accepts, corrects or turns down.
Nothing is saved until a person confirms it.

Status: early development (0.x) — the packages are published, and may change between minor versions.

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
app.MapLowline("/lowline");                    // POST /lowline/{form}/propose · settle · fill · judge · GET report
```

```html
<lowline-form src="/lowline" form="intake" record="r-17"></lowline-form>
```

The form is its fields, given as JSON in the engine's own shape (`form`) or as what formdown's `getSchema()` gives
(`formdown`):

```json
{ "form": { "fields": [
  { "name": "customer", "kind": "text" },
  { "name": "owner", "kind": "choice", "choices": ["kim", "lee"] }
] } }
```

A field's `kind` is `text`, `number`, `date`, `choice`, `flag` or `reference`; a choice field may be `open` (it takes
values outside its choices too) or `multiple`. Which fields the engine decides — suggests from the records — and which
it only reads as clues: unless the form says (a field's `role`, `decided` or `observed`, or its `policy`, `offer`,
`confirm` or `off`), every closed choice field with two choices or more is decided and the rest are clues. A single
checkbox is never decided that way — it is often a consent, which must not be suggested however consistent the
records are. Give `"inference": "declared-only"` beside `form` to have only the fields the form declares decided.

Decided fields settled together — an industry and an occupation, a class and its detail — name one group (a field's
`together`, or formdown's `suggest:together`). Where one open field of the group is shown no suggestion, the others
are shown none either (`together`, with the fields that held them back in `with`): a person settling the unsure one is
not led by the sure one. Once the person has filled the unsure one, it is no longer open, and asked again the others
are shown. A field the records would answer once the group's other fields took the values suggested for them — the
occupation, while the industry it rests on is still empty — is waiting, not unsure, and holds nothing back: the
industry is shown, and the occupation is asked again once the industry is settled. A group no other field shares is
refused. A form the engine refuses — this, or one with no field to decide — is refused when it is defined (`Form` in
`AddLowline`, or `LowlineForms.Define`), so the host fails as it starts rather than answering each request with the
same 400.

The routes, under the prefix `MapLowline` was given:

| Route | Takes | Answers |
|---|---|---|
| `POST {form}/propose` | `{ "id", "values" }` — the record so far | per open decided field: the suggestion, what it rests on, its `promise`, or why there is none |
| `POST {form}/settle` | `{ "id", "saved", "draft" }` — no `saved` with `Saved` | `{ "id", "settledAt" }`; 400 for a value the form cannot hold, and nothing is learned |
| `GET {form}/report` | — | per decided field: the thresholds chosen, how many records they were chosen on (`chosenOn`), and what the replay of the records saw at them |
| `POST {form}/fill` | `{ "values", "text" }` | the model's values as suggestions; 404 saying so without a model |
| `POST {form}/judge` | `{ "id", "values" }` | the model's judgements for the fields the records could not answer; 404 saying so without a model |

A form not defined is 404. Each request's memory space and allowed choices come from the host (below), never from the
request body.

Suggestions start once the records can back them. The engine replays the confirmed records to choose, per decided
field, the threshold at which its answers have been right at least 80% of the time, over ten answers or more (thirty
for the similar records layer); until a field reaches that, it is shown nothing, with the reason. `report` says how
close each field has come. A suggestion's `promise` is the precision its threshold's replay expects of the next
answers — a figure to read, not a level of confidence: every suggestion shown has already met the target.

One answer in twenty is held back to check it (the element's `rate`): the field shows no suggestion, the person types
the value, and the value counts toward the field's precision as one written with nothing in view. Without such checks,
a field suggested well would be settled mostly by taking its suggestions, and its precision would come to rest on the
suggestions themselves. A field held back holds back the open fields settled together with it (each proposal names its
`together` group): the checked value is written with nothing of its group in view. Only the field drawn is the check. A
host drawing its own checks finds the fields to hide with `Draft::hidden` (Rust) or `Recheck.Hidden` (.NET).

Before putting the engine in front of people, a host can see how it would have done on the records it already has:
make the lines with `LowlineEngine.Record`, choose thresholds on them with `Choose`, and read `Report`.

Set the element's `content` to the form's formdown text. While a record is written, the element asks what to show
for the fields the engine decides, draws each suggestion in its field with what it rests on, and keeps the account of
what the person took, changed or turned down; `save()` sends it with the values, and the engine learns from it. The
host decides, per request, the memory space a record belongs to (`Space` — a workplace, a team; records of one space
never answer for another) and the choices its person may pick (`Allowed`) — a value outside them is never suggested.
Authentication and authorization stay the host's. A host that draws its own form imports `Draft`, `Session` and
`LowlineClient` from `@iyulab/lowline-form/headless` — no element, no Lit, no formdown — and does what the element does:
`Session.apply` each round of proposals (it draws the checks and hides what they hold back), then
`LowlineClient.settle(form, id, session.draft, values)` once the record is saved.

What the engine learns is what a person confirmed, so `settle` takes the values it is sent as the save itself. A host
that already stores its records through its own API — its permissions, validation and corrections — gives `Saved`,
which reads a record back from its own store: the element then calls `settle()` after the host's save, the request
carries only the account of what was shown, and the engine learns the record as stored. A record the host has not
stored is 404, and nothing is learned.

Filling from what a person wrote is on when the host gives its model (`UseModel` with an `ILowlineModel`): the engine
tells the model which fields are still empty and what each may hold, checks what comes back, and offers each value
in its field for the person to take — never put in on its own, and never counted as the records' own answer.

The same model judges what the records cannot answer yet — a decided field of a record unlike any confirmed before.
Such a field asks for a judgement and says which of the record's values to read; the element asks the host, the host
puts it to the model (`ILowlineModel.JudgeAsync`), and the model's value is offered back to the engine, which shows it
as its own answer when the model trusts it and it is one of the field's choices. A judgement is shown, never put in on
its own; taken by a person, it counts as the engine's answer. Whether a judgement is trusted is the model's own measure:
the engine does not yet choose a threshold for judgements from how often they held, and `Report` has no row for them.
Where the records have evidence, a judgement changes nothing.

A host whose records live somewhere of its own — files, an existing database — can keep that as the original and
build the engine's store from it: `LowlineEngine.Record` makes the line to store for each record (its values, how each
decided field was settled, when), and `Learn` takes them together. `Report` says, per decided field, how far the
records have come: the thresholds chosen, with the precision and answers the replay saw at them, or how close it came.

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
