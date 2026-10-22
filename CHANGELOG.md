# Changelog

All notable changes to this project are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `lowline` crate (Rust, no I/O):
  - `Policy` — `off`, `offer` or `confirm` per field: whether it is suggested for, and whether the host may put the
    suggestion in without a person taking it.
  - `Draft` — the account of one record while it is written: the values it was opened with, the suggestion last
    shown for each field and whether it was turned down. `Draft::settle` turns the saved values into one
    `Settlement` per decided field — `Accept`, `Correct`, `Reject`, `Revert`, `Restore`, `Set`, `Enter`, `Fill`,
    and `AcceptOther` / `CorrectOther` for a value suggested by something other than the decider — so a value a
    person took from a suggestion is never counted as one they typed on their own. `Draft::hold` holds a field's
    answer back for a check: the value the person then settles is a `Check`, with the probability the field was drawn
    with.
  - `Recheck` — how often an answer that would be shown is drawn instead to be checked (one in twenty by default);
    `Recheck::draw(proposal, roll)` takes the host's uniform roll and draws only a value the decider suggests.
  - `Form` — the fields a host hands over, in one shape whatever the form was written in: name, kind (`text`,
    `number`, `date`, `choice`, `flag`, `reference`), choices, and what the form declares about suggesting (role,
    policy, evidence, parent). `Form::resolve` works out the rest. With `Inference::ClosedChoices` (the default) a
    form that declares no role has every closed choice field — two or more choices, nothing outside them — decided
    and the rest observed; a single checkbox or switch is never decided that way, since it is often a consent. A
    form that declares any role is taken at its word, and `Inference::DeclaredOnly` decides only what is declared.
    A policy of `offer` or `confirm` declares a field decided. A field may also name how many leading characters of
    its value are its class (`coarse`) and the values it must not miss (`must_catch`, one of its choices).
  - `serde` feature: forms, policies, suggestions, drafts and settlements read and write as JSON.
  - `formdown` feature: `FormdownSchema` reads the JSON formdown's `getSchema()` gives, and turns into a `Form` —
    fields in the form's order, buttons and file fields left out, select · radio · checkbox group as choices, a single
    checkbox as a flag, a relation as a reference, `suggest:*` attributes as the field's role, policy, evidence,
    parent, class and values not to miss (`judged` is decided). A password is never evidence.
  - `Proposal` — what a host shows for a decided field: one suggestion (a value, or a class), whether the host may put
    it in by itself (`prefill` — only a value, only under `offer`), where it came from (`Layer`: `key`, `similar`,
    `judgement`) and what it rests on (`Basis`: another field's value, or a settled record and how alike it is); or,
    when nothing is shown, why (`Abstain`: `off`, `no-evidence`, `unsure`, `not-allowed`, `needs-judgement` — with the
    values a judgement from outside the records would read). With `serde`, the JSON a host in any language reads.
  - `gil` feature (crate `iyulab-gil` 0.7): `gil::schema(name, fields)` hands a resolved form to the Gil decider as
    its `Schema` — role, evidence, policy (`offer` → `Suggest`, `confirm` → `ConfirmRequired`), a closed choice
    field's choices as candidates, the class prefix and the values not to miss — checked as Gil checks one.
    `gil::tune(schema, records, &Tune::default())` chooses each decided field's thresholds on the settled records —
    counting only `gil::COUNTED` — sets them on the schema and gives the `Tuning` a host keeps and chooses again once
    it is stale. The default `Tune` holds every band of answers to 0.8 over at least ten answers and trusts the
    similar records layer only on a promise resting on thirty. `gil::record(id, fields, saved, settlements, settled_at)` is a saved record as Gil keeps it — a decided field of
    several values as a set, an observed one as one value (sorted, joined with `", "`), each settlement's kind and a
    check's probability. `gil::proposal(field, answer, allowed)` turns Gil's answer for a field into a `Proposal`: the trusted value, else
    the trusted class, else why not; `allowed` — the choices the host lets this person pick now — keeps a value
    outside them from being suggested or moved to a nearby choice. `gil::decision(proposal, settlement)` is one
    decision as Gil's `usage` counts it — answered or not, accepted, corrected, entered, checked — with no values sent
    on. `gil::COUNTED` (`Enter`, `Check`) is what to count a field's precision on when its thresholds are chosen, so
    values taken from the suggestions do not grade the suggestions. `Settlement::to_gil` gives each settlement in Gil's words; a set is settled and restored as a set. An observed
    field that takes several values is one attribute (Gil takes several only for a decided one); a field's parent is
    not handed over. With `serde`, Gil's types serialize too.
    `gil::Engine` is that whole round for one form, kept between calls: `learn` the stored records, `restore` the
    stored tuning, `stale` says when to `tune` again (none chosen yet, or Gil's reason), `propose` answers each open
    decided field of a record from its values so far — with the choices this person may pick, by field — and `settle`
    turns a save and its `Draft` into the record to store and learns it. The engine keeps the schema and the memories;
    the records and the tuning are the host's to store, one engine per form and store.
- `lowline-ffi` crate (library `lowline_native`, not published to crates.io — the native side of the .NET host): a
  C ABI over `gil::Engine`. One handle per form — `lowline_engine_new` from a definition (`name`, the form as `form`
  or as formdown's `getSchema()` JSON under `formdown`, optional `inference` and `tune`), then `learn` (records as
  JSON lines), `restore` (a stored tuning), `stale`, `tune`, `propose` (values and the choices this person may pick,
  by field) and `settle` (saved values and the draft, giving back the record to store); `lowline_engine_settled`
  counts what was learned. Everything crosses as JSON; nothing calls back into the host. Statuses, text and buffer
  rules and handle threading are those of the Gil decider's C ABI: `OK`, `INVALID_INPUT`, `INVALID_ARGUMENT`,
  `PANIC`, `BUFFER_TOO_SMALL`, `BROKEN`, the last error and last result copied out on the calling thread, and an
  engine left broken by a panic while it changed. A panic inside a call is reported, not printed; one elsewhere in
  the process still reaches the panic hook that was there. `lowline_abi_version` is 1.
- `serde` feature: `gil::Tune` (camelCase, each field defaulted) and `gil::Stale` read and write as JSON.
- `Lowline` .NET host (`bindings/csharp`, not yet packed): `LowlineEngine` over the C ABI — `Create` from a
  definition, `Learn`, `Restore`, `Stale`, `Tune`, `Propose` (typed `Proposal`, `Suggestion`, `Basis`, `Layer`,
  `Abstain`) and `Settle` (giving back a `SettledRecord` to store); safe to share across threads, proposals running
  alongside each other. `ILowlineStore` is where a host keeps the settled records and the tuning, by `LowlineScope` —
  a form within a memory space (a workplace, a team) whose records never answer for another — with forgetting
  records before a date or by id; `InMemoryLowlineStore` keeps them in memory. `LowlineForms` runs the engines of a
  host's forms over its store: each started from the stored records and tuning when first asked, each save stored
  and learned, the thresholds chosen again and stored when they no longer stand, an engine started again after
  records are forgotten.
- `gil::Engine::choose` (and `lowline_engine_choose`, `LowlineEngine.Choose`): the tuning `tune` would choose,
  reading the engine only, so it goes on answering while thresholds are chosen; `restore` puts the result in.
  `LowlineForms` chooses this way in the background after a save that leaves the thresholds stale (`WhenTunedAsync`
  waits for it); the first start of a scope still chooses before it answers.
- `LowlineOptions` — a store (`UseStore`) and forms (`Form`), built into `LowlineForms`.
- `Lowline.Sqlite`: `SqliteLowlineStore` keeps records and tunings in two tables of its own (`lowline_records`,
  `lowline_tunings`), made on first use; `options.UseSqlite(connectionString)`.
- `Lowline.AspNetCore`: `services.AddLowline(o => o.UseSqlite(…).Form(name, definition))` and
  `app.MapLowline("/lowline")` — `POST {form}/propose` (`{ id, values }` → proposals) and `POST {form}/settle`
  (`{ id, saved, draft }` → `{ id, settledAt }`), 404 for a form not defined, 400 with the engine's message for input
  it refuses. The host decides each request's memory space (`Space`, from its own authentication) and the choices its
  person may pick (`Allowed`); authorization is the host's, on the returned route group.
- `<lowline-form>` (`bindings/web`, package `@iyulab/lowline-form`, not yet published): a formdown form whose decided
  fields are suggested through a host's routes — `src`, `form`, `record`, `content`, `data`. It draws each suggestion
  in its field with what it rests on (a field's value as the record holds it now), puts in what the host may fill,
  holds a field's answer back now and then to check it (`rate`, one in twenty by default, drawn once per field of a
  record), keeps the account of what was shown, taken and turned down, and sends it with `save()`; the host's engine
  counts it, so nothing is counted in the browser. `Draft`, `Session` and `LowlineClient` are exported for a host that
  draws its own form.
- `serde` feature: every part of a `Draft` may be left out when it is read — what a browser keeps.
