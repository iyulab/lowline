//! A C ABI over the Lowline engine ([`lowline::gil::Engine`]), for the .NET host.
//!
//! One handle, a [`LowlineEngine`], holds one form's round with the decider: the records settled for it learned, its
//! decided fields answered, a person's save settled and learned from, and its thresholds chosen again when they no
//! longer stand. Everything crosses as JSON in the engine's `serde` form; records are Gil's, one per line. Nothing
//! calls back into the host and nothing is stored: the host stores each record and tuning it is handed back, and hands
//! them in again when it starts. The engine keeps no clock — a time is given in 100-nanosecond ticks since the Unix
//! epoch, UTC.
//!
//! Threads: a function that takes the handle as `*const` only reads it, and may run on several threads at once; one
//! that takes it as `*mut` changes it, and needs it to itself — a host that shares a handle across threads holds a
//! reader–writer lock, shared for the first kind and exclusive for the second.
//!
//! Every function returns a status — [`LOWLINE_OK`], or a code whose message [`lowline_last_error`] copies out — and no
//! panic crosses the boundary. A function with a text result keeps it on the calling thread for
//! [`lowline_last_result`] and writes its length to `result_len`. Input the engine refuses comes back as
//! [`LOWLINE_INVALID_INPUT`] before anything changes. A [`LOWLINE_PANIC`] from a call that changes the handle is a
//! defect that may have stopped the change halfway: the engine is broken, and every later call with it returns
//! [`LOWLINE_BROKEN`] until it is freed. [`lowline_abi_version`] says which version of this interface the library
//! speaks.
//!
//! The statuses and the rules for text, buffers and handles are those of the Gil decider's C ABI.

mod support;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};

use gil::schema::Record;
use gil::tuning::Tuning;
use lowline::gil::{Engine, Tune};
use lowline::{Draft, FieldValue, Form, FormdownSchema, Inference, SettledBy};
use serde::Deserialize;

pub use support::LowlineStr;
use support::{Failure, argument, call, hand_out, input, release, set_result, text};

/// The call succeeded.
pub const LOWLINE_OK: i32 = support::OK;
/// The engine refused its input (a form it cannot resolve, a record that does not read); the message says what.
pub const LOWLINE_INVALID_INPUT: i32 = support::INVALID_INPUT;
/// The call itself was malformed: a null pointer, text that is not UTF-8.
pub const LOWLINE_INVALID_ARGUMENT: i32 = support::INVALID_ARGUMENT;
/// The engine panicked — a defect — reported instead of unwinding into the caller.
pub const LOWLINE_PANIC: i32 = support::PANIC;
/// Kept for the numbering shared with Gil's C ABI; no function here returns it.
pub const LOWLINE_BUFFER_TOO_SMALL: i32 = support::BUFFER_TOO_SMALL;
/// The engine is broken: an earlier call that changed it panicked partway. Free it and build it again.
pub const LOWLINE_BROKEN: i32 = support::BROKEN;

/// The version of this interface — its functions and statuses, and the JSON they read and write. It changes whenever
/// a binding built for one version would misread the library of another.
pub const LOWLINE_ABI_VERSION: u32 = 1;

/// [`lowline_engine_settle`]: a person saved the record.
pub const LOWLINE_SETTLED_BY_PERSON: u8 = 0;
/// [`lowline_engine_settle`]: the application saved it on its own — an import, another program's values.
pub const LOWLINE_SETTLED_BY_APPLICATION: u8 = 1;

/// One form's engine.
pub struct LowlineEngine {
    engine: Engine,
    broken: AtomicBool,
}

// The functions that only read the handle may share it across threads (see the module's threads paragraph).
const _: () = {
    const fn shared<T: Sync>() {}
    shared::<LowlineEngine>();
};

/// What [`lowline_engine_new`] reads: the schema name, the form — as the engine's `Form`, or as the JSON formdown's
/// `getSchema()` gives — and, optionally, how fields are decided when the form does not say and how thresholds are
/// chosen.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Definition {
    name: String,
    #[serde(default)]
    form: Option<Form>,
    #[serde(default)]
    formdown: Option<FormdownSchema>,
    #[serde(default)]
    inference: Inference,
    #[serde(default)]
    tune: Tune,
}

/// The engine behind a handle, refused when null or broken.
///
/// # Safety
/// `engine` is null or a live handle that no other thread changes during the call.
unsafe fn live<'a>(engine: *const LowlineEngine) -> Result<&'a LowlineEngine, Failure> {
    // SAFETY: forwarded from the caller.
    let found = unsafe { engine.as_ref() }.ok_or_else(|| argument("engine is null"))?;
    if found.broken.load(Ordering::Relaxed) {
        return Err(Failure(
            LOWLINE_BROKEN,
            "the engine is broken: an earlier call that changed it panicked partway; free it and build it again"
                .to_owned(),
        ));
    }
    Ok(found)
}

/// As [`live`], exclusively.
///
/// # Safety
/// `engine` is null or a live handle that nothing else refers to during the call.
unsafe fn live_mut<'a>(engine: *mut LowlineEngine) -> Result<&'a mut Engine, Failure> {
    // SAFETY: forwarded from the caller.
    unsafe { live(engine) }?;
    // SAFETY: non-null (checked above), and the caller guarantees exclusive use.
    Ok(&mut unsafe { &mut *engine }.engine)
}

/// Runs a call that changes `engine`, marking it broken when the call panics.
///
/// # Safety
/// `engine` is null or a live handle that nothing else refers to during the call.
unsafe fn changing(
    engine: *mut LowlineEngine,
    body: impl FnOnce(&mut Engine) -> Result<(), Failure>,
) -> i32 {
    // SAFETY: forwarded from the caller.
    let status = call(|| body(unsafe { live_mut(engine) }?));
    if status == LOWLINE_PANIC
        // SAFETY: forwarded from the caller.
        && let Some(found) = unsafe { engine.as_ref() }
    {
        found.broken.store(true, Ordering::Relaxed);
    }
    status
}

/// Settled records from JSON lines — one Gil record per line, blank lines skipped — each checked against the engine's
/// form: a value for a field the form does not have, or a set for a field that takes one value, refuses the whole text.
fn records(engine: &Engine, lines: &str) -> Result<Vec<Record>, Failure> {
    let read: Vec<Record> = lines
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(at, line)| {
            serde_json::from_str(line)
                .map_err(|e| input(format!("record line {} does not read: {e}", at + 1)))
        })
        .collect::<Result<_, _>>()?;
    let attributes = &engine.schema().attributes;
    for record in &read {
        for name in record.values.keys().chain(record.sets.keys()) {
            let Some(attribute) = attributes.iter().find(|a| &a.name == name) else {
                return Err(input(format!(
                    "record '{}' has a value for '{name}', which the form does not have",
                    record.id
                )));
            };
            if record.sets.contains_key(name) && !attribute.multiple {
                return Err(input(format!(
                    "record '{}' has several values for '{name}', which takes one",
                    record.id
                )));
            }
        }
    }
    Ok(read)
}

/// The choices this person may pick, by field: a JSON object, or empty text for none.
fn choices(allowed: &str) -> Result<BTreeMap<String, Vec<String>>, Failure> {
    if allowed.trim().is_empty() {
        Ok(BTreeMap::new())
    } else {
        json(allowed, "allowed")
    }
}

fn json<T: for<'de> Deserialize<'de>>(text: &str, what: &str) -> Result<T, Failure> {
    serde_json::from_str(text).map_err(|e| input(format!("{what} does not read: {e}")))
}

fn written(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).expect("the engine's types serialize")
}

/// The version of this interface the library speaks ([`LOWLINE_ABI_VERSION`]) — what a binding checks before its
/// first call.
#[unsafe(no_mangle)]
pub extern "C" fn lowline_abi_version() -> u32 {
    LOWLINE_ABI_VERSION
}

/// Copies the message of the last refused call on this thread into `buffer` as UTF-8 (no terminator) and returns its
/// full length in bytes — call with a capacity of 0 to learn the length. Nothing is written when it does not fit. An
/// empty message means the last call succeeded.
///
/// # Safety
/// `buffer` is null with `capacity` 0, or points to `capacity` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_last_error(buffer: *mut u8, capacity: usize) -> usize {
    // SAFETY: forwarded from the caller.
    unsafe { support::copy_last_error(buffer, capacity) }
}

/// Copies the text result of the last call on this thread (the length that call wrote to its `result_len`) into
/// `buffer` as UTF-8 (no terminator) and returns its full length. Nothing is written when it does not fit; the result
/// stays until the thread's next call.
///
/// # Safety
/// `buffer` is null with `capacity` 0, or points to `capacity` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_last_result(buffer: *mut u8, capacity: usize) -> usize {
    // SAFETY: forwarded from the caller.
    unsafe { support::copy_last_result(buffer, capacity) }
}

/// An engine for the form `definition` describes, handed out through `out`: a JSON object with `name` (what the
/// decider's memories are kept under — two forms of one host take different names), the form as `form` (the engine's
/// `Form`) or as `formdown` (what formdown's `getSchema()` gives), and optionally `inference` (`"closed-choices"`, the
/// default, or `"declared-only"`) and `tune` (`targetPrecision`, `minimumAnswered`, `similarMinimumAnswered`, `rule`;
/// each left out takes its default). It answers nothing until records are learned and its thresholds chosen.
///
/// # Safety
/// `definition` is valid for the call; `out` points to one writable pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_new(
    definition: LowlineStr,
    out: *mut *mut LowlineEngine,
) -> i32 {
    call(|| {
        if out.is_null() {
            return Err(argument("out is null"));
        }
        // SAFETY: forwarded from the caller.
        let definition: Definition =
            json(unsafe { text(definition, "definition") }?, "definition")?;
        let form = match (definition.form, definition.formdown) {
            (Some(form), None) => form,
            (None, Some(formdown)) => Form::from(formdown),
            _ => {
                return Err(input(
                    "definition gives the form as one of `form` or `formdown`",
                ));
            }
        };
        let fields = form
            .resolve(definition.inference)
            .map_err(|e| input(format!("the form does not resolve: {e}")))?;
        let engine = Engine::new(&definition.name, fields, definition.tune).map_err(input)?;
        // SAFETY: forwarded from the caller.
        unsafe {
            hand_out(
                out,
                LowlineEngine {
                    engine,
                    broken: AtomicBool::new(false),
                },
            )
        }
    })
}

/// Frees an engine; null does nothing.
///
/// # Safety
/// `engine` is null or a live handle, freed once and not used after.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_free(engine: *mut LowlineEngine) {
    // SAFETY: forwarded from the caller.
    unsafe { release(engine) }
}

/// How many records the engine has learned, one per record id; 0 for null.
///
/// # Safety
/// `engine` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_settled(engine: *const LowlineEngine) -> usize {
    // SAFETY: forwarded from the caller.
    unsafe { engine.as_ref() }.map_or(0, |e| e.engine.settled())
}

/// Learns settled records — the stored ones at start-up, or ones settled elsewhere since — given as JSON lines, one
/// Gil record per line. A record whose id was learned before replaces what that one taught.
///
/// # Safety
/// `engine` is a live handle used by nothing else during the call; `records` is valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_learn(
    engine: *mut LowlineEngine,
    records: LowlineStr,
) -> i32 {
    // SAFETY: forwarded from the caller.
    unsafe {
        changing(engine, |engine| {
            let read = self::records(engine, text(records, "records")?)?;
            engine.learn(&read);
            Ok(())
        })
    }
}

/// Puts back a tuning the host stored — Gil's tuning as JSON — setting its thresholds on the engine's schema. Empty
/// text leaves the engine untuned. Restore it after learning the stored records, so that whether it still stands is
/// judged on them.
///
/// # Safety
/// `engine` is a live handle used by nothing else during the call; `tuning` is valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_restore(
    engine: *mut LowlineEngine,
    tuning: LowlineStr,
) -> i32 {
    // SAFETY: forwarded from the caller.
    unsafe {
        changing(engine, |engine| {
            let tuning = text(tuning, "tuning")?;
            let tuning: Option<Tuning> = if tuning.trim().is_empty() {
                None
            } else {
                Some(json(tuning, "tuning")?)
            };
            engine.restore(tuning);
            Ok(())
        })
    }
}

/// Why the thresholds should be chosen again, as JSON: `null` while they stand, `"untuned"` when none were chosen or
/// restored, or `{"tuning": …}` with Gil's reason — another version of it, a changed form, or the learned records
/// grown or shrunk by a tenth since the choice.
///
/// # Safety
/// `engine` is a live handle; `result_len` points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_stale(
    engine: *const LowlineEngine,
    result_len: *mut usize,
) -> i32 {
    call(|| {
        // SAFETY: forwarded from the caller.
        let engine = &unsafe { live(engine) }?.engine;
        // SAFETY: forwarded from the caller.
        unsafe { set_result(written(&engine.stale()), result_len) }
    })
}

/// Chooses the decided fields' thresholds again on the settled records — all of them, as the host stores them, JSON
/// lines as [`lowline_engine_learn`] reads — and learns them; the result is the tuning to store, Gil's as JSON.
///
/// # Safety
/// `engine` is a live handle used by nothing else during the call; `records` is valid for the call; `result_len`
/// points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_tune(
    engine: *mut LowlineEngine,
    records: LowlineStr,
    result_len: *mut usize,
) -> i32 {
    // SAFETY: forwarded from the caller.
    unsafe {
        changing(engine, |engine| {
            let read = self::records(engine, text(records, "records")?)?;
            let tuning = written(engine.tune(&read));
            set_result(tuning, result_len)
        })
    }
}

/// The tuning [`lowline_engine_tune`] would choose on `records`, leaving the engine as it is: it only reads the engine,
/// so proposals go on alongside it — a host chooses on a worker this way and puts the result in with
/// [`lowline_engine_restore`]. The records should be the ones the engine has learned.
///
/// # Safety
/// `engine` is a live handle; `records` is valid for the call; `result_len` points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_choose(
    engine: *const LowlineEngine,
    records: LowlineStr,
    result_len: *mut usize,
) -> i32 {
    call(|| {
        // SAFETY: forwarded from the caller, for every pointer below.
        let engine = &unsafe { live(engine) }?.engine;
        let read = self::records(engine, unsafe { text(records, "records") }?)?;
        unsafe { set_result(written(&engine.choose(&read)), result_len) }
    })
}

/// What to show for each decided field of record `id` that is still open, given its `values` so far — a JSON object
/// of a text, or a list of texts for a field that takes several, by field. `allowed` is a JSON object of the choices
/// this person may pick now, by field (empty text for none); a field it leaves out may take any value. The result is a
/// JSON array of proposals in the form's order: the suggestion and what it rests on, or why there is none.
///
/// # Safety
/// `engine` is a live handle; the texts are valid for the call; `result_len` points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_propose(
    engine: *const LowlineEngine,
    id: LowlineStr,
    values: LowlineStr,
    allowed: LowlineStr,
    result_len: *mut usize,
) -> i32 {
    call(|| {
        // SAFETY: forwarded from the caller, for every pointer below.
        let engine = &unsafe { live(engine) }?.engine;
        let id = unsafe { text(id, "id") }?;
        let values: BTreeMap<String, FieldValue> =
            json(unsafe { text(values, "values") }?, "values")?;
        let allowed = choices(unsafe { text(allowed, "allowed") }?)?;
        let proposals = engine.propose(id, &values, &allowed);
        unsafe { set_result(written(&proposals), result_len) }
    })
}

/// The fields a host's model may fill for a record holding `values` (as [`lowline_engine_propose`] reads them), with
/// `allowed` as it reads it: a JSON array of `{ name, kind, choices }` — the fields still empty that take one value,
/// with a closed choice field's choices narrowed to those this person may pick.
///
/// # Safety
/// `engine` is a live handle; the texts are valid for the call; `result_len` points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_describe(
    engine: *const LowlineEngine,
    values: LowlineStr,
    allowed: LowlineStr,
    result_len: *mut usize,
) -> i32 {
    call(|| {
        // SAFETY: forwarded from the caller, for every pointer below.
        let engine = &unsafe { live(engine) }?.engine;
        let values: BTreeMap<String, FieldValue> =
            json(unsafe { text(values, "values") }?, "values")?;
        let allowed = choices(unsafe { text(allowed, "allowed") }?)?;
        unsafe { set_result(written(&engine.describe(&values, &allowed)), result_len) }
    })
}

/// What to show for each field the host's model answered — `answered`, a JSON object of its values by field — for a
/// record holding `values`: a JSON array of proposals, each a suggestion from elsewhere that is never put in on its
/// own, or why there is none (`not-a-choice`, `not-allowed`, `malformed`).
///
/// # Safety
/// `engine` is a live handle; the texts are valid for the call; `result_len` points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_fill(
    engine: *const LowlineEngine,
    values: LowlineStr,
    allowed: LowlineStr,
    answered: LowlineStr,
    result_len: *mut usize,
) -> i32 {
    call(|| {
        // SAFETY: forwarded from the caller, for every pointer below.
        let engine = &unsafe { live(engine) }?.engine;
        let values: BTreeMap<String, FieldValue> =
            json(unsafe { text(values, "values") }?, "values")?;
        let allowed = choices(unsafe { text(allowed, "allowed") }?)?;
        let answered: BTreeMap<String, FieldValue> =
            json(unsafe { text(answered, "answered") }?, "answered")?;
        unsafe {
            set_result(
                written(&engine.fill(&values, &allowed, &answered)),
                result_len,
            )
        }
    })
}

/// Settles record `id` as saved — its `saved` values (as [`lowline_engine_propose`] reads them) and `draft`, the JSON
/// of the account kept while it was written (empty text for a record written with nothing shown) — `by` a person or
/// the application (`LOWLINE_SETTLED_BY_…`) at `settled_at`, learns it, and gives back the record to store: one Gil
/// record as JSON, the line [`lowline_engine_learn`] reads back.
///
/// # Safety
/// `engine` is a live handle used by nothing else during the call; the texts are valid for the call; `result_len`
/// points to one writable `usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lowline_engine_settle(
    engine: *mut LowlineEngine,
    id: LowlineStr,
    saved: LowlineStr,
    draft: LowlineStr,
    by: u8,
    settled_at: i64,
    result_len: *mut usize,
) -> i32 {
    // SAFETY: forwarded from the caller, for every pointer below.
    unsafe {
        changing(engine, |engine| {
            let id = text(id, "id")?;
            let saved: BTreeMap<String, FieldValue> = json(text(saved, "saved")?, "saved")?;
            let draft = text(draft, "draft")?;
            let draft: Draft = if draft.trim().is_empty() {
                Draft::new()
            } else {
                json(draft, "draft")?
            };
            let by = match by {
                LOWLINE_SETTLED_BY_PERSON => SettledBy::Person,
                LOWLINE_SETTLED_BY_APPLICATION => SettledBy::Application,
                other => {
                    return Err(argument(format!(
                        "by is {other}, neither a person nor the application"
                    )));
                }
            };
            if result_len.is_null() {
                return Err(argument("result_len is null"));
            }
            let record = engine.settle(id, &saved, &draft, by, settled_at);
            set_result(written(&record), result_len)
        })
    }
}
