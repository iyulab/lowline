# Changelog

All notable changes to this project are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A class suggested from the similar records layer (a field with a coarse level) now carries that layer's promise; it
  carried the key layer's, or none where the keys back no class. `FieldReport` gains `coarse_similar` (`coarseSimilar` in
  .NET and the web client) — the threshold at which the similar records layer is trusted for the class.

### Added

- **Breaking (source):** `LowlineForms.SettleAsync` takes `attestation` before `cancellationToken`; a call that passes the token
  by position must name it (`cancellationToken: ct`) or pass `null` first.
- `Attestation` (`Draft::attest`, C ABI `lowline_engine_settle`'s new `attest` text, .NET `LowlineEngine.Settle`'s `attestation`,
  `LowlineForms.SettleAsync`'s `attestation`, `LowlineWebOptions.Attest`): what a host vouches for about a record in place
  of what the form being measured says of itself — who settled it (an opaque id), its batch, and the fields the host
  drew for a check with the probability each was drawn with. Given, it replaces the draft's own settler, batch and
  checks even where it names none; left out, the draft stands as before. A probability that is none is refused. The C ABI
  is version 6 (`lowline_engine_settle` takes `attest` after `draft`; empty text for none).

## [0.9.0] - 2026-10-27

### Changed

- **Breaking:** `Engine::record` takes the account of what was shown, `draft: Option<&Draft>`, after `checks`, so a host that
  keeps its records somewhere of its own can give a record the same detail `Engine::settle` writes: the answer in view,
  its layer and promise, the time to settle, the order values arrived in, who settled it and the batch. What the draft
  does not report is left out. Unlike `settle`, `record` does not stamp the form's version â the engine knows the one it
  holds now, not the one the record was settled under. Pass `None` for the record it gave before. The C ABI is version 5
  (`lowline_engine_record` takes `draft` after `checks`; empty text for none), and .NET `LowlineEngine.Record` takes an
  optional `draft` JSON text last, as `Settle` does.

## [0.8.0] - 2026-10-27

### Added

- A settled record carries what Gil's record line can hold beyond how each field was settled, from what the draft
  reports. New on `Draft`: `show_proposed` and `hold_proposed` (the layer and promise of the answer in view, or held
  back for a check), `open_at`, `save_at` and `reach` (times on the host's own steady clock, in milliseconds),
  `arrived` (the order values arrived in), `settled_by` (an opaque id, no name) and `in_batch`. `Engine::settle` writes
  them as `suggested`, `sources`, `promises`, `settle_ms`, `open_ms`, `settled_by`, `arrival` and `batch`, and
  `Engine::with_form_version` names the version of the form's code lists (`form_version`). `gil::annotate` does the
  same for a host that builds its records with `gil::record`. A draft that reports none of it gives the record it
  gave before, and the draft's JSON gains only the keys that were reported.
- The `lowline-form` element reports them: the layer and promise of what it shows, when a field was reached or its
  suggestion came into view, the order values arrived in, and the save. Its new `settled-by` and `batch` attributes
  (`Session.beforeSave` in the headless build) name who saved and the batch. A definition may carry `formVersion`
  (.NET `LowlineEngine.Create`, the C ABI) so every settled record names the version of the form's code lists.
- `Audit` (Rust, .NET): a settled record drawn at a rate, off by default, to be settled once more by another person who
  sees neither the first settler's values nor the decider's answer. Its `draw(roll)` answers the probability to hold the
  record's decided fields back with (`Draft::hold_proposed`, then `settled_by` for the second person); the record is
  settled again under its id as checks, which is how well each person settles can be told from the answers alone.

- `Engine::usage(records)` (C ABI `lowline_engine_usage`, .NET `LowlineEngine.Usage` returning `AttributeUsage` per field)
  counts what the answers came to on the stored record lines, without content: how often an answer was offered, how
  people settled it, and the precision it realized beside the one it promised. The C ABI version is 4.

### Changed

- The `gil` feature takes `iyulab-gil` 0.9. `gil::decision` now builds the record line Gil counts usage from
  (`gil::schema::Record`) instead of the removed `usage::Decision`, so its result is passed to `gil::usage::usage`
  by reference, and a rejected suggestion is an answer shown with no settlement. Rust callers of `decision` adjust.
- The C ABI takes its status codes, buffer rules and handle rules from the `iyulab-ffi-support` crate instead of a copy
  of its own; the exported functions and their numbers are unchanged. A panic inside a call stays quiet on the host's
  stderr while a panic elsewhere in the process still reaches the panic hook that was set before.

## [0.7.0] - 2026-10-24

### Added

- Each proposal names its group of fields settled together (`together` â .NET `Proposal.Together`, web `together`),
  and `Draft::hidden` (.NET `Recheck.Hidden`) answers the fields of a round to hide for a check: each field held back
  and the open fields of its group. The web element hides them the same way.
- A report says how many settled records its thresholds were chosen on (`chosenOn` â .NET `FieldReport.ChosenOn`,
  Rust `FieldReport::chosen_on`): records settled since are answered from but not yet in the replay. A tuning stored by
  an earlier version reports it from the tuning.

### Changed

- The web element takes `@formdown/ui` 0.26, which reads `suggest:together`.
- A form the engine refuses is refused when it is defined â `LowlineOptions.Form` (so in `AddLowline`) and
  `LowlineForms.Define` throw `ArgumentException` naming the form â instead of every request for it answering 400 with
  the same message.

### Fixed

- Records saved while thresholds were being chosen again are no longer left out of the choice until the next save:
  asked again while a choice runs, `LowlineForms` chooses once more after it if the thresholds still do not stand
  (before, the request was dropped, and a burst of saves could leave thresholds chosen on its first few records).
- A field held back for a check no longer leaves the fields settled together with it showing their suggestions. The
  value checked is counted as one written with nothing in view, which the suggestion beside it made untrue.

- A group of fields settled together no longer hides a sure field behind one that only waits for it. Where the open
  field without a suggestion would be answered once the group's other fields took the values suggested for them â an
  occupation resting on the industry, both empty â the records are not unsure of it yet, so the industry is shown and
  the occupation is asked again once the industry is settled. A field that stays unsure even then still holds the
  group. Before, both stayed empty until a person filled the sure one with nothing in view.

## [0.6.0] - 2026-10-24

### Added

- Fields settled together: a field's `together` (formdown's `suggest:together`) names a group of decided fields â an
  industry and an occupation, a class and its detail. Where one open field of the group is shown no suggestion, the
  others are shown none either: `Abstain::Together` (.NET `Abstain.Together`, web `'together'`), with the fields that
  held them back in `Proposal::with` (.NET `With`, web `with`). The held fields keep their thresholds and promises; they
  are only not shown, and never put in. A field the person has filled is no longer open and is not counted, so asked
  again once the unsure one is settled, the others are shown. `propose_field` without text typed answers as `propose`
  does. A group only one field is in is refused (`SchemaError::TogetherAlone`).

### Changed

- **Breaking (Rust):** `Abstain` has a variant more (`Together`), so a `match` over it needs an arm, and `Proposal` and
  `Field` have a field more (`with`, `together`), so a struct literal needs it â `..Proposal::abstain(â¦)` and
  `Field::new` give the empty value.
- The web element takes `@formdown/ui` 0.25.

## [0.5.0] - 2026-10-24

### Added

- A host reads how far each form's records have come: `LowlineForms.ReportAsync(scope)` and `GET {form}/report`
  (`MapLowline`) answer, per decided field of the memory space, the thresholds chosen and what the replay saw at them â
  precision, the share answered, the promise over the latest records, how many checks â or how close it came; the web
  client has `report(form)` with the `FieldReport` type. Counts and rates only, never a record's values. Before, only
  the low-level `LowlineEngine.Report` said it, and a host on the routes could not show its people whether a suggestion
  had earned trust.
- A suggestion carries its promise: `Proposal.promise` (Rust, .NET `Proposal.Promise`, web `promise`) is how often an
  answer of that kind for the field has been right â the replay's promise at the threshold it was held to: the key
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
- `Engine::restore` does not put back a tuning the form can no longer take â one naming a key field the form has
  dropped. The engine stays untuned and `Engine::stale` says so, where it used to set the old settings on the new form.
- `Engine::forget` takes a record out of the decider's memories (Gil's `Decider::remove`) instead of learning an empty
  record in its place, so a forgotten record is never offered again as a similar record.
- **Breaking: a save the form cannot hold is refused, and nothing is learned.** `Engine::settle` (Rust) now returns
  `Result`; it refuses a value for a field the form does not have, several values for a field that takes one, and a
  value of a choice field that is none of its choices (a field marked `open` keeps taking others) â the checks
  `Engine::record` already made, plus the choices. `Engine::record` (a record settled elsewhere, earlier) still takes a
  choice the form has dropped since â that is history, and is never suggested. Before, such a value was stored and learned as
  a person's confirmation, and a misspelt field name was dropped without a word. Through the C ABI and .NET
  (`LowlineEngine.Settle`, `LowlineForms.SettleAsync`) it is `INVALID_INPUT` / `ArgumentException`; `POST {form}/settle`
  answers 400 with the message. To move: `engine.settle(â¦)?` in Rust; a host whose saves can hold values outside the
  form marks those choice fields `open` or fixes the values before settling.
- `POST {form}/fill` and `judge` without a model (`UseModel`) still answer 404, now with a problem body saying no
  model is configured, so a host can tell it apart from a form that is not defined.

## [0.4.0] - 2026-10-23

### Added

- .NET's `Recheck` draws a decided field for a check as the Rust `Recheck` does: `new Recheck(rate).Draw(proposal, roll)`
  answers the probability to give `LowlineEngine.Record` among its checks, or `null` â only a value the decider would
  show is drawn. A host that writes its own form no longer restates the rule.
- An engine forgets records deleted since it learned them: `Engine::forget(ids)` (`LowlineEngine.Forget`,
  `lowline_engine_forget`) takes back what they taught, so a host that keeps its engine between changes to its records
  need not learn all the rest again after a deletion. An id never learned is passed by.

### Changed

- `ILowlineStore.ForgetBeforeAsync` gives the ids of the records it removed, not their count, so `LowlineForms` can have
  a running engine forget them. A host with a store of its own returns the ids (`Lowline.Sqlite` reads them with
  `DELETE â¦ RETURNING id`). `LowlineForms.ForgetAsync` and `ForgetBeforeAsync` no longer stop the scope's engine to
  learn every remaining record again on its next use: it forgets what went, and chooses its thresholds again in the
  background when the rest no longer bear them out.
- A record settled elsewhere carries its checks: `Engine::record(id, saved, settled, checks, settled_at)` takes the
  fields whose answer was held back for a check while the record was written, each with the probability it was drawn
  with, and settles them as checks â the same line a draft that held them back makes. A host that keeps its records
  somewhere of its own and draws checks can now build the engine's store from them. `LowlineEngine.Record` takes them as
  an optional last argument, and .NET's `SettlementKind` gains `Check`. A check said among the settlements is still
  refused: it carries its probability. The C ABI is version 3 (`lowline_engine_record` takes `checks`).

## [0.3.0] - 2026-10-23

### Added

- `LowlineWebOptions.Saved`: a host that stores its records through its own API reads a record back from its own
  store, and `settle` learns that â not the values the request carries. A record the host has not stored is 404 and
  nothing is learned, so a request cannot have values learned as a person's that were never saved. The form element's
  `settle()` sends only the account of what was shown, for such a host.
- `@iyulab/lowline-form/headless`: `Draft`, `Session`, `LowlineClient` and their types without the element â it brings
  in neither Lit nor formdown, so a host drawing its own form ships a few kilobytes instead of both. The package
  declares which of its files register the element (`sideEffects`), so a bundler drops what is not used.
- Counting a field on every settled value until its checks gather: `Counting::SettledUntilChecked { checks }`
  (`"counting": {"settled-until-checked": {"checks": 20}}`) counts each decided field on every value a person settled
  until `checks` checks of it are among the records, then only on values settled with nothing in view and checks â for
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
  (files, an existing database) â its values, how each decided field was settled, and when â without learning it, so a
  host builds the engine's store from its own records and hands the lines to `learn` together. A decided field left out
  was settled by a person with nothing in view; a check is refused (it is drawn while a record is written). Also
  `lowline_engine_record`, `LowlineEngine.Record` and the `SettlementKind` enum.

- How each decided field's replays went: `Engine::report` (and `lowline_engine_report`, `LowlineEngine.Report`) gives,
  per field, the threshold chosen with the precision, answer rate, answers, lookups and promise the replay saw at it â
  or, when none was right often enough, the closest it came â with the fields that key it, its thresholds for each
  length typed, its coarse level's and the similar records layer's (and whether that layer is offered). It is kept
  with the tuning, so an engine restored from storage reports the same.

- Which settlements a field's precision is counted on: `Tune.counting` â `unprompted` (the default, as before: values
  settled with nothing in view, and checks) or `settled` (every value a person settled, a suggestion taken or changed
  included). Without checks the default never meets the engine's own misses â where people take or correct what it
  offers it can promise more than it keeps, and run out of values to count on the fields it answers best; a host that
  does not draw checks (`Recheck`) counts `settled`.

### Changed

- `tune` chooses every threshold the decider answers with, in the order a suggestion leans on them: how readily each
  field's keys are believed after a few settlements, the fields that key a decided field, its key and similar records
  thresholds, its thresholds for each length typed (free text fields), and its coarse level's thresholds (similar
  records held to the same gate as the value's). Before, only the key and similar records thresholds were chosen, so a
  field named after the very thing decided could be outweighed by a broad one, typing answered at the untyped
  threshold, and a declared coarse level was never offered. `gil::tune` takes the resolved form as well (breaking).
- What `tune` hands back to store is `Tuned` â the tuning and the report together (`{"tuning": â¦, "report": [â¦]}`).
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
  (`needs-judgement`, with the fields and values to read in `asks`) is answered by `Engine::offer` â the model's ranked
  values join the decider's candidates after values a memory trusts and before its guesses; a trusted one among the
  field's choices is shown as the decider's answer from the `judgement` layer and settles as `Accept` when a person
  takes it. Where a memory has evidence a judgement changes nothing. Also `lowline_engine_offer`, `LowlineEngine.Offer`;
  in .NET the model judges through `ILowlineModel.JudgeAsync` (a model that only fills answers nothing),
  `LowlineForms.JudgeAsync` puts each asking field to it, and `MapLowline` adds `POST {form}/judge` (`{ id, values }`)
  when a model is given â kept apart from `propose`, which answers at once. A field with nothing to read yet is not put
  to the model. A judgement is shown for a person to take and never put in unasked, whatever the field's policy.
  `<lowline-form>` asks `judge` after a round in which a field asks for a judgement, once for what it reads, and shows
  the answer in its field (Â«Suggested from what was writtenÂ») while the person writes on; without a model (404) it
  stops asking. The sample's stand-in model judges too.
- Filling a form from what a person wrote or showed, through the host's model â the engine calls none. `fill::describe`
  tells the host what to ask for: the fields still empty that take one value, each with its kind and, for a closed
  choice, the choices this person may pick. `fill::fill` checks the model's values against their fields and shows each
  as a suggestion from elsewhere (`Origin::Other` â never put in on its own, not counted for the decider), or why not:
  `Abstain::NotAChoice` (never moved to a nearby choice), `NotAllowed`, `Malformed` (not a number, a date or a time as
  the field takes it). Also `Engine::describe` / `fill`, `lowline_engine_describe` / `_fill`, `LowlineEngine.Describe` /
  `Fill`; in .NET the host gives its model as `ILowlineModel` (`UseModel`), `LowlineForms.FillAsync` asks it, and
  `MapLowline` adds `POST {form}/fill` (`{ values, text }`) when a model is given â 404 otherwise.
- `<lowline-form>`.`fill(text)` asks the host's `fill` route and offers each value in its field (Â«From what you
  wroteÂ»), ahead of what the records suggest, until the person picks it or turns it down; nothing is put in on its own.
  The sample host fills through a stand-in model.

- A conformance test against the Gil decider's own fixture (computed with `iyulab-gil` 0.7.0): its 24 settlement
  cases â what a host reported for a field, the value saved, who saved it â give the settlement, the record line and
  the usage counts it holds, and its 18 boundaries of a tuning going stale fall where it puts them.

- `lowline` crate (Rust, no I/O):
  - `Policy` â `off`, `offer` or `confirm` per field: whether it is suggested for, and whether the host may put the
    suggestion in without a person taking it.
  - `Draft` â the account of one record while it is written: the values it was opened with, the suggestion last
    shown for each field and whether it was turned down. `Draft::settle` turns the saved values into one
    `Settlement` per decided field â `Accept`, `Correct`, `Reject`, `Revert`, `Restore`, `Set`, `Enter`, `Fill`,
    and `AcceptOther` / `CorrectOther` for a value suggested by something other than the decider â so a value a
    person took from a suggestion is never counted as one they typed on their own. `Draft::hold` holds a field's
    answer back for a check: the value the person then settles is a `Check`, with the probability the field was drawn
    with.
  - `Recheck` â how often an answer that would be shown is drawn instead to be checked (one in twenty by default);
    `Recheck::draw(proposal, roll)` takes the host's uniform roll and draws only a value the decider suggests.
  - `Form` â the fields a host hands over, in one shape whatever the form was written in: name, kind (`text`,
    `number`, `date`, `choice`, `flag`, `reference`), choices, and what the form declares about suggesting (role,
    policy, evidence, parent). `Form::resolve` works out the rest. With `Inference::ClosedChoices` (the default) a
    form that declares no role has every closed choice field â two or more choices, nothing outside them â decided
    and the rest observed; a single checkbox or switch is never decided that way, since it is often a consent. A
    form that declares any role is taken at its word, and `Inference::DeclaredOnly` decides only what is declared.
    A policy of `offer` or `confirm` declares a field decided. A field may also name how many leading characters of
    its value are its class (`coarse`) and the values it must not miss (`must_catch`, one of its choices).
  - `serde` feature: forms, policies, suggestions, drafts and settlements read and write as JSON.
  - `formdown` feature: `FormdownSchema` reads the JSON formdown's `getSchema()` gives, and turns into a `Form` â
    fields in the form's order, buttons and file fields left out, select Â· radio Â· checkbox group as choices, a single
    checkbox as a flag, a relation as a reference, `suggest:*` attributes as the field's role, policy, evidence,
    parent, class and values not to miss (`judged` is decided). A password is never evidence.
  - `Proposal` â what a host shows for a decided field: one suggestion (a value, or a class), whether the host may put
    it in by itself (`prefill` â only a value, only under `offer`), where it came from (`Layer`: `key`, `similar`,
    `judgement`) and what it rests on (`Basis`: another field's value, or a settled record and how alike it is); or,
    when nothing is shown, why (`Abstain`: `off`, `no-evidence`, `unsure`, `not-allowed`, `needs-judgement` â with the
    values a judgement from outside the records would read). With `serde`, the JSON a host in any language reads.
  - `gil` feature (crate `iyulab-gil` 0.7): `gil::schema(name, fields)` hands a resolved form to the Gil decider as
    its `Schema` â role, evidence, policy (`offer` â `Suggest`, `confirm` â `ConfirmRequired`), a closed choice
    field's choices as candidates, the class prefix and the values not to miss â checked as Gil checks one.
    `gil::tune(schema, records, &Tune::default())` chooses each decided field's thresholds on the settled records â
    counting only `gil::COUNTED` â sets them on the schema and gives the `Tuning` a host keeps and chooses again once
    it is stale. The default `Tune` holds every band of answers to 0.8 over at least ten answers and trusts the
    similar records layer only on a promise resting on thirty. `gil::record(id, fields, saved, settlements, settled_at)` is a saved record as Gil keeps it â a decided field of
    several values as a set, an observed one as one value (sorted, joined with `", "`), each settlement's kind and a
    check's probability. `gil::proposal(field, answer, allowed)` turns Gil's answer for a field into a `Proposal`: the trusted value, else
    the trusted class, else why not; `allowed` â the choices the host lets this person pick now â keeps a value
    outside them from being suggested or moved to a nearby choice. `gil::decision(proposal, settlement)` is one
    decision as Gil's `usage` counts it â answered or not, accepted, corrected, entered, checked â with no values sent
    on. `gil::COUNTED` (`Enter`, `Check`) is what to count a field's precision on when its thresholds are chosen, so
    values taken from the suggestions do not grade the suggestions. `Settlement::to_gil` gives each settlement in Gil's words; a set is settled and restored as a set. An observed
    field that takes several values is one attribute (Gil takes several only for a decided one); a field's parent is
    not handed over. With `serde`, Gil's types serialize too.
    `gil::Engine` is that whole round for one form, kept between calls: `learn` the stored records, `restore` the
    stored tuning, `stale` says when to `tune` again (none chosen yet, or Gil's reason), `propose` answers each open
    decided field of a record from its values so far â with the choices this person may pick, by field â and `settle`
    turns a save and its `Draft` into the record to store and learns it. The engine keeps the schema and the memories;
    the records and the tuning are the host's to store, one engine per form and store.
- `lowline-ffi` crate (library `lowline_native`, not published to crates.io â the native side of the .NET host): a
  C ABI over `gil::Engine`. One handle per form â `lowline_engine_new` from a definition (`name`, the form as `form`
  or as formdown's `getSchema()` JSON under `formdown`, optional `inference` and `tune`), then `learn` (records as
  JSON lines), `restore` (a stored tuning), `stale`, `tune`, `propose` (values and the choices this person may pick,
  by field) and `settle` (saved values and the draft, giving back the record to store); `lowline_engine_settled`
  counts what was learned. Everything crosses as JSON; nothing calls back into the host. Statuses, text and buffer
  rules and handle threading are those of the Gil decider's C ABI: `OK`, `INVALID_INPUT`, `INVALID_ARGUMENT`,
  `PANIC`, `BUFFER_TOO_SMALL`, `BROKEN`, the last error and last result copied out on the calling thread, and an
  engine left broken by a panic while it changed. A panic inside a call is reported, not printed; one elsewhere in
  the process still reaches the panic hook that was there. `lowline_abi_version` is 1.
- `serde` feature: `gil::Tune` (camelCase, each field defaulted) and `gil::Stale` read and write as JSON.
- `Lowline` .NET host (`bindings/csharp`, not yet packed): `LowlineEngine` over the C ABI â `Create` from a
  definition, `Learn`, `Restore`, `Stale`, `Tune`, `Propose` (typed `Proposal`, `Suggestion`, `Basis`, `Layer`,
  `Abstain`) and `Settle` (giving back a `SettledRecord` to store); safe to share across threads, proposals running
  alongside each other. `ILowlineStore` is where a host keeps the settled records and the tuning, by `LowlineScope` â
  a form within a memory space (a workplace, a team) whose records never answer for another â with forgetting
  records before a date or by id; `InMemoryLowlineStore` keeps them in memory. `LowlineForms` runs the engines of a
  host's forms over its store: each started from the stored records and tuning when first asked, each save stored
  and learned, the thresholds chosen again and stored when they no longer stand, an engine started again after
  records are forgotten.
- `gil::Engine::choose` (and `lowline_engine_choose`, `LowlineEngine.Choose`): the tuning `tune` would choose,
  reading the engine only, so it goes on answering while thresholds are chosen; `restore` puts the result in.
  `LowlineForms` chooses this way in the background after a save that leaves the thresholds stale (`WhenTunedAsync`
  waits for it); the first start of a scope still chooses before it answers.
- `LowlineOptions` â a store (`UseStore`) and forms (`Form`), built into `LowlineForms`.
- `Lowline.Sqlite`: `SqliteLowlineStore` keeps records and tunings in two tables of its own (`lowline_records`,
  `lowline_tunings`), made on first use; `options.UseSqlite(connectionString)`.
- `Lowline.AspNetCore`: `services.AddLowline(o => o.UseSqlite(â¦).Form(name, definition))` and
  `app.MapLowline("/lowline")` â `POST {form}/propose` (`{ id, values }` â proposals) and `POST {form}/settle`
  (`{ id, saved, draft }` â `{ id, settledAt }`), 404 for a form not defined, 400 with the engine's message for input
  it refuses. The host decides each request's memory space (`Space`, from its own authentication) and the choices its
  person may pick (`Allowed`); authorization is the host's, on the returned route group.
- `<lowline-form>` (`bindings/web`, package `@iyulab/lowline-form`, not yet published): a formdown form whose decided
  fields are suggested through a host's routes â `src`, `form`, `record`, `content`, `data`. It draws each suggestion
  in its field with what it rests on (a field's value as the record holds it now), puts in what the host may fill,
  holds a field's answer back now and then to check it (`rate`, one in twenty by default, drawn once per field of a
  record), keeps the account of what was shown, taken and turned down, and sends it with `save()`; the host's engine
  counts it, so nothing is counted in the browser. `Draft`, `Session` and `LowlineClient` are exported for a host that
  draws its own form.
- `serde` feature: every part of a `Draft` may be left out when it is read â what a browser keeps.
- `<lowline-form>`: turning down a suggestion the form put in empties the field again, and the turned-down suggestion
  is neither shown nor put back when the form asks again for that record; another suggestion is.
- `samples/aspnet`: a web host with a learning form â the two server pieces and the element â over SQLite. `npm run
  bundle` in `bindings/web` builds the element as one file with Lit and formdown inside.
