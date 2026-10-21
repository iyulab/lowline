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
    `gil::record(id, fields, saved, settlements, settled_at)` is a saved record as Gil keeps it — a decided field of
    several values as a set, an observed one as one value (sorted, joined with `", "`), each settlement's kind and a
    check's probability. `gil::proposal(field, answer, allowed)` turns Gil's answer for a field into a `Proposal`: the trusted value, else
    the trusted class, else why not; `allowed` — the choices the host lets this person pick now — keeps a value
    outside them from being suggested or moved to a nearby choice. `gil::decision(proposal, settlement)` is one
    decision as Gil's `usage` counts it — answered or not, accepted, corrected, entered, checked — with no values sent
    on. `gil::COUNTED` (`Enter`, `Check`) is what to count a field's precision on when its thresholds are chosen, so
    values taken from the suggestions do not grade the suggestions. `Settlement::to_gil` gives each settlement in Gil's words; a set is settled and restored as a set. An observed
    field that takes several values is one attribute (Gil takes several only for a decided one); a field's parent is
    not handed over. With `serde`, Gil's types serialize too.
