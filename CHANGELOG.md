# Changelog

All notable changes to this project are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Fields settled together: a field's `together` (formdown's `suggest:together`) names a group of decided fields — an
  industry and an occupation, a class and its detail. Where one open field of the group is shown no suggestion, the
  others are shown none either: `Abstain::Together` (.NET `Abstain.Together`, web `'together'`), with the fields that
  held them back in `Proposal::with` (.NET `With`, web `with`). The held fields keep their thresholds and promises; they
  are only not shown, and never put in. A field the person has filled is no longer open and is not counted, so asked
  again once the unsure one is settled, the others are shown. `propose_field` without text typed answers as `propose`
  does. A group only one field is in is refused (`SchemaError::TogetherAlone`).

### Changed

- **Breaking (Rust):** `Abstain` has a variant more (`Together`), so a `match` over it needs an arm, and `Proposal` and
  `Field` have a field more (`with`, `together`), so a struct literal needs it — `..Proposal::abstain(…)` and
  `Field::new` give the empty value.
- The web element takes `@formdown/ui` 0.25.

## [0.5.0] - 2026-10-24

### Added

- A host reads how far each form's records have come: `LowlineForms.ReportAsync(scope)` and `GET {form}/report`
  (`MapLowline`) answer, per decided field of the memory space, the thresholds chosen and what the replay saw at them —
  precision, the share answered, the promise over the latest records, how many checks — or how close it came; the web
  client has `report(form)` with the `FieldReport` type. Counts and rates only, never a record's values. Before, only
  the low-level `LowlineEngine.Report` said it, and a host on the routes could not show its people whether a suggestion
  had earned trust.
- A suggestion carries its promise: `Proposal.promise` (Rust, .NET `Proposal.Promise`, web `promise`) is how often an
  answer of that kind for the field has been right — the replay's promise at the threshold it was held to: the key
  layer's, the threshold for the characters typed, the coarse level's for a class, or the similar records layer's. Left
  out for a judgement from outside the records, a value from elsewhere, and before thresholds are chosen.
- `lowline::gil::decision` carries the proposal's promise, so Gil's `usage` counts set the precision the answers
  realized beside what they promised (`AttributeUsage::promise`); it was always `None`.

### Changed

- **Breaking (Rust, feature `gil`): the decider is `iyulab-gil` 0.8.** The Gil schema an engine hands out
  (`Engine::schema`, `lowline::gil::schema`) has private fields: read it with `schema.name()` and
  `schema.attributes()`, and build a changed one with `gil::schema::Schema::new`. Answer sources in Gil's own vocabulary
  are `Source::KeyMemory` and `Source::SimilarRecord`; the engine's `Layer` is unchanged. The .NET and web bindings and
  the C ABI are unchanged.
- Choosing thresholds is about four times quicker on a large history: on 10,000 settled records, `Engine::tune` took
  2.9 s instead of 12.1 s, with the same choices (Gil 0.8's key layer and replays).
- `Engine::restore` does not put back a tuning the form can no longer take — one naming a key field the form has
  dropped. The engine stays untuned and `Engine::stale` says so, where it used to set the old settings on the new form.
- `Engine::forget` takes a record out of the decider's memories (Gil's `Decider::remove`) instead of learning an empty
  record in its place, so a forgotten record is never offered again as a similar record.
- **Breaking: a save the form cannot hold is refused, and nothing is learned.** `Engine::settle` (Rust) now returns
  `Result`; it refuses a value for a field the form does not have, several values for a field that takes one, and a
  value of a choice field that is none of its choices (a field marked `open` keeps taking others) — the checks
  `Engine::record` already made, plus the choices. `Engine::record` (a record settled elsewhere, earlier) still takes a
  choice the form has dropped since — that is history, and is never suggested. Before, such a value was stored and learned as
  a person's confirmation, and a misspelt field name was dropped without a word. Through the C ABI and .NET
  (`LowlineEngine.Settle`, `LowlineForms.SettleAsync`) it is `INVALID_INPUT` / `ArgumentException`; `POST {form}/settle`
  answers 400 with the message. To move: `engine.settle(…)?` in Rust; a host whose saves can hold values outside the
  form marks those choice fields `open` or fixes the values before settling.
- `POST {form}/fill` and `judge` without a model (`UseModel`) still answer 404, now with a problem body saying no
  model is configured, so a host can tell it apart from a form that is not defined.

## [0.4.0] - 2026-10-23

### Added

- .NET's `Recheck` draws a decided field for a check as the Rust `Recheck` does: `new Recheck(rate).Draw(proposal, roll)`
  answers the probability to give `LowlineEngine.Record` among its checks, or `null` — only a value the decider would
  show is drawn. A host that writes its own form no longer restates the rule.
- An engine forgets records deleted since it learned them: `Engine::forget(ids)` (`LowlineEngine.Forget`,
  `lowline_engine_forget`) takes back what they taught, so a host that keeps its engine between changes to its records
  need not learn all the rest again after a deletion. An id never learned is passed by.

### Changed

- `ILowlineStore.ForgetBeforeAsync` gives the ids of the records it removed, not their count, so `LowlineForms` can have
  a running engine forget them. A host with a store of its own returns the ids (`Lowline.Sqlite` reads them with
  `DELETE … RETURNING id`). `LowlineForms.ForgetAsync` and `ForgetBeforeAsync` no longer stop the scope's engine to
  learn every remaining record again on its next use: it forgets what went, and chooses its thresholds again in the
  background when the rest no longer bear them out.
- A record settled elsewhere carries its checks: `Engine::record(id, saved, settled, checks, settled_at)` takes the
  fields whose answer was held back for a check while the record was written, each with the probability it was drawn
  with, and settles them as checks — the same line a draft that held them back makes. A host that keeps its records
  somewhere of its own and draws checks can now build the engine's store from them. `LowlineEngine.Record` takes them as
  an optional last argument, and .NET's `SettlementKind` gains `Check`. A check said among the settlements is still
  refused: it carries its probability. The C ABI is version 3 (`lowline_engine_record` takes `checks`).

## [0.3.0] - 2026-10-23

### Added

- `LowlineWebOptions.Saved`: a host that stores its records through its own API reads a record back from its own
  store, and `settle` learns that — not the values the request carries. A record the host has not stored is 404 and
  nothing is learned, so a request cannot have values learned as a person's that were never saved. The form element's
  `settle()` sends only the account of what was shown, for such a host.
- `@iyulab/lowline-form/headless`: `Draft`, `Session`, `LowlineClient` and their types without the element — it brings
  in neither Lit nor formdown, so a host drawing its own form ships a few kilobytes instead of both. The package
  declares which of its files register the element (`sideEffects`), so a bundler drops what is not used.
- Counting a field on every settled value until its checks gather: `Counting::SettledUntilChecked { checks }`
  (`"counting": {"settled-until-checked": {"checks": 20}}`) counts each decided field on every value a person settled
  until `checks` checks of it are among the records, then only on values settled with nothing in view and checks — for
  a host that draws checks rarely, so a field is not left with nothing to count while they gather. A field's report
  says how many checks it has (`checks`) and how it was counted (`counting`; `Counting` in .NET).

### Changed

- `LowlineClient.settle(form, id, draft, saved?)`: the draft comes before the values, which a host reading its own
  records leaves out (was `settle(form, id, saved, draft)`). A `settle` request with no `saved` values to a host that
  reads none of its own is refused (400).
- `Counting::kinds(checked)` takes the number of checks of the field; `Counting::resolve(checked)` says which of the
  two countings that makes it.

### Fixed

- The npm package `@iyulab/lowline-form` carries the license text (`LICENSE`), not only its name, as the NuGet packages
  and crates do: a host gathering the notices of what it bundles finds the text in the package.

## [0.2.0] - 2026-10-23

### Added

- Asking for one field while a person types into it: `Engine::propose_field` takes the text typed so far and suggests
  only a value that begins with it, held to the threshold chosen for that many characters. A field picked from choices,
  or typed past the lengths chosen for, is answered nothing while typed into (`unsure`). Also
  `lowline_engine_propose_field`, `LowlineEngine.ProposeField` and `LowlineForms.ProposeFieldAsync`. `Tune.typedLongest`
  (3 by default; 0 chooses none) bounds the lengths.

- Records settled elsewhere: `Engine::record` makes the line to store for a record kept somewhere of the host's own
  (files, an existing database) — its values, how each decided field was settled, and when — without learning it, so a
  host builds the engine's store from its own records and hands the lines to `learn` together. A decided field left out
  was settled by a person with nothing in view; a check is refused (it is drawn while a record is written). Also
  `lowline_engine_record`, `LowlineEngine.Record` and the `SettlementKind` enum.

- How each decided field's replays went: `Engine::report` (and `lowline_engine_report`, `LowlineEngine.Report`) gives,
  per field, the threshold chosen with the precision, answer rate, answers, lookups and promise the replay saw at it —
  or, when none was right often enough, the closest it came — with the fields that key it, its thresholds for each
  length typed, its coarse level's and the similar records layer's (and whether that layer is offered). It is kept
  with the tuning, so an engine restored from storage reports the same.

- Which settlements a field's precision is counted on: `Tune.counting` — `unprompted` (the default, as before: values
  settled with nothing in view, and checks) or `settled` (every value a person settled, a suggestion taken or changed
  included). Without checks the default never meets the engine's own misses — where people take or correct what it
  offers it can promise more than it keeps, and run out of values to count on the fields it answers best; a host that
  does not draw checks (`Recheck`) counts `settled`.

### Changed

- `tune` chooses every threshold the decider answers with, in the order a suggestion leans on them: how readily each
  field's keys are believed after a few settlements, the fields that key a decided field, its key and similar records
  thresholds, its thresholds for each length typed (free text fields), and its coarse level's thresholds (similar
  records held to the same gate as the value's). Before, only the key and similar records thresholds were chosen, so a
  field named after the very thing decided could be outweighed by a broad one, typing answered at the untyped
  threshold, and a declared coarse level was never offered. `gil::tune` takes the resolved form as well (breaking).
- What `tune` hands back to store is `Tuned` — the tuning and the report together (`{"tuning": …, "report": […]}`).
  A tuning stored by 0.1 (Gil's tuning alone) is restored as none, so the thresholds are chosen again on the next tune
  (breaking: `gil::tune` and `Engine::choose` return `Tuned`, `Engine::restore` takes it).
- The C ABI is version 2 (`lowline_engine_propose_field`, `lowline_engine_record`, `lowline_engine_report`).

### Fixed

- The NuGet packages carry the license text (`LICENSE`), not only its name: a host shipping them has the text to ship
  along.
- `Lowline` carries the notices of the crates linked into its native library (`THIRD-PARTY-NOTICES.txt`, their
  license texts), which 0.1.0 left out.

## [0.1.0] - 2026-10-23

### Added

- Packages: `lowline` on crates.io; `Lowline` (with the native library for Windows, Linux and macOS, x64 and arm64),
  `Lowline.Sqlite` and `Lowline.AspNetCore` on NuGet; `@iyulab/lowline-form` on npm, with a one-file build for a page
  with no build step (`dist/bundle/lowline-form.bundle.js`). One version for all of them.
- Judging what the records could not answer, through the host's model. A proposal that asks for a judgement
  (`needs-judgement`, with the fields and values to read in `asks`) is answered by `Engine::offer` — the model's ranked
  values join the decider's candidates after values a memory trusts and before its guesses; a trusted one among the
  field's choices is shown as the decider's answer from the `judgement` layer and settles as `Accept` when a person
  takes it. Where a memory has evidence a judgement changes nothing. Also `lowline_engine_offer`, `LowlineEngine.Offer`;
  in .NET the model judges through `ILowlineModel.JudgeAsync` (a model that only fills answers nothing),
  `LowlineForms.JudgeAsync` puts each asking field to it, and `MapLowline` adds `POST {form}/judge` (`{ id, values }`)
  when a model is given — kept apart from `propose`, which answers at once. A field with nothing to read yet is not put
  to the model. A judgement is shown for a person to take and never put in unasked, whatever the field's policy.
  `<lowline-form>` asks `judge` after a round in which a field asks for a judgement, once for what it reads, and shows
  the answer in its field («Suggested from what was written») while the person writes on; without a model (404) it
  stops asking. The sample's stand-in model judges too.
- Filling a form from what a person wrote or showed, through the host's model — the engine calls none. `fill::describe`
  tells the host what to ask for: the fields still empty that take one value, each with its kind and, for a closed
  choice, the choices this person may pick. `fill::fill` checks the model's values against their fields and shows each
  as a suggestion from elsewhere (`Origin::Other` — never put in on its own, not counted for the decider), or why not:
  `Abstain::NotAChoice` (never moved to a nearby choice), `NotAllowed`, `Malformed` (not a number, a date or a time as
  the field takes it). Also `Engine::describe` / `fill`, `lowline_engine_describe` / `_fill`, `LowlineEngine.Describe` /
  `Fill`; in .NET the host gives its model as `ILowlineModel` (`UseModel`), `LowlineForms.FillAsync` asks it, and
  `MapLowline` adds `POST {form}/fill` (`{ values, text }`) when a model is given — 404 otherwise.
- `<lowline-form>`.`fill(text)` asks the host's `fill` route and offers each value in its field («From what you
  wrote»), ahead of what the records suggest, until the person picks it or turns it down; nothing is put in on its own.
  The sample host fills through a stand-in model.

- A conformance test against the Gil decider's own fixture (computed with `iyulab-gil` 0.7.0): its 24 settlement
  cases — what a host reported for a field, the value saved, who saved it — give the settlement, the record line and
  the usage counts it holds, and its 18 boundaries of a tuning going stale fall where it puts them.

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
- `<lowline-form>`: turning down a suggestion the form put in empties the field again, and the turned-down suggestion
  is neither shown nor put back when the form asks again for that record; another suggestion is.
- `samples/aspnet`: a web host with a learning form — the two server pieces and the element — over SQLite. `npm run
  bundle` in `bindings/web` builds the element as one file with Lit and formdown inside.
