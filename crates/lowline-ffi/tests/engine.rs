//! The C ABI drives one form's round as a .NET host would — every input as JSON text, every result through the
//! caller's buffer — and it answers as the engine does. Also: a refusal comes back as a status and a message before
//! anything changes, and a malformed call never reaches the engine.

use std::ptr;

use lowline::{Draft, Suggestion};
use lowline_native::*;
use serde_json::{Value, json};

fn s(text: &str) -> LowlineStr {
    LowlineStr {
        ptr: text.as_ptr(),
        len: text.len(),
    }
}

const NONE: LowlineStr = LowlineStr {
    ptr: ptr::null(),
    len: 0,
};

fn copied(copy: unsafe extern "C" fn(*mut u8, usize) -> usize) -> String {
    let len = unsafe { copy(ptr::null_mut(), 0) };
    let mut buffer = vec![0u8; len];
    assert_eq!(unsafe { copy(buffer.as_mut_ptr(), buffer.len()) }, len);
    String::from_utf8(buffer).unwrap()
}

fn last_error() -> String {
    copied(lowline_last_error)
}

fn ok(status: i32) {
    assert_eq!(status, LOWLINE_OK, "{}", last_error());
    assert_eq!(last_error(), "");
}

/// The result of the call just made, read as the length it wrote says.
fn result(len: usize) -> Value {
    let text = copied(lowline_last_result);
    assert_eq!(text.len(), len);
    serde_json::from_str(&text).unwrap()
}

const DEFINITION: &str = r#"{
    "name": "intake",
    "form": { "fields": [
        { "name": "customer", "kind": "text" },
        { "name": "owner", "kind": "choice", "choices": ["kim", "lee"] }
    ] }
}"#;

fn engine() -> *mut LowlineEngine {
    let mut engine = ptr::null_mut();
    ok(unsafe { lowline_engine_new(s(DEFINITION), &mut engine) });
    assert!(!engine.is_null());
    engine
}

/// `n` stored records, settled by a person with nothing in view — Acme's owner kim, Beta's lee — as JSON lines, made
/// through the ABI itself.
fn stored(n: i64) -> String {
    let maker = engine();
    let mut lines = String::new();
    for i in 0..n {
        let (customer, owner) = if i % 2 == 0 {
            ("Acme", "kim")
        } else {
            ("Beta", "lee")
        };
        let saved = json!({ "customer": customer, "owner": owner }).to_string();
        let mut len = 0;
        ok(unsafe {
            lowline_engine_settle(
                maker,
                s(&format!("r{i}")),
                s(&saved),
                NONE,
                LOWLINE_SETTLED_BY_PERSON,
                i,
                &mut len,
            )
        });
        lines.push_str(&copied(lowline_last_result));
        lines.push('\n');
    }
    unsafe { lowline_engine_free(maker) };
    lines
}

fn propose(engine: *const LowlineEngine, values: &Value, allowed: &str) -> Value {
    let mut len = 0;
    ok(unsafe {
        lowline_engine_propose(
            engine,
            s("new"),
            s(&values.to_string()),
            s(allowed),
            &mut len,
        )
    });
    result(len)
}

#[test]
fn a_host_round_through_the_abi() {
    assert_eq!(lowline_abi_version(), LOWLINE_ABI_VERSION);
    let records = stored(40);
    let engine = engine();

    // Start-up: the stored records, no tuning yet — so it is chosen and handed back to store.
    ok(unsafe { lowline_engine_learn(engine, s(&records)) });
    assert_eq!(unsafe { lowline_engine_settled(engine) }, 40);
    ok(unsafe { lowline_engine_restore(engine, NONE) });
    let mut len = 0;
    ok(unsafe { lowline_engine_stale(engine, &mut len) });
    assert_eq!(result(len), json!("untuned"));
    ok(unsafe { lowline_engine_tune(engine, s(&records), &mut len) });
    let tuning = result(len);
    assert_eq!(tuning["settled"], 40);
    ok(unsafe { lowline_engine_stale(engine, &mut len) });
    assert_eq!(result(len), Value::Null);

    // A record being written: the owner is suggested, and the host may put it in.
    let shown = propose(engine, &json!({ "customer": "Beta" }), "");
    assert_eq!(shown[0]["field"], "owner");
    assert_eq!(shown[0]["suggestion"]["value"], "lee");
    assert_eq!(shown[0]["prefill"], true);
    // Not for a person who may pick only kim.
    let kim_only = propose(
        engine,
        &json!({ "customer": "Beta" }),
        r#"{"owner":["kim"]}"#,
    );
    assert_eq!(kim_only[0]["suggestion"], Value::Null);
    assert_eq!(kim_only[0]["abstain"], "not-allowed");

    // The person takes it and saves: the record to store says the value was accepted.
    let mut draft = Draft::new();
    draft.show("owner", Suggestion::new("lee"));
    let draft = serde_json::to_string(&draft).unwrap();
    let saved = json!({ "customer": "Beta", "owner": "lee" }).to_string();
    ok(unsafe {
        lowline_engine_settle(
            engine,
            s("new"),
            s(&saved),
            s(&draft),
            LOWLINE_SETTLED_BY_PERSON,
            40,
            &mut len,
        )
    });
    let record = copied(lowline_last_result);
    let read: Value = serde_json::from_str(&record).unwrap();
    assert_eq!(read["id"], "new");
    assert_eq!(read["settlements"]["owner"], "Accept");
    assert_eq!(unsafe { lowline_engine_settled(engine) }, 41);

    // Chosen on a worker while proposals go on: the engine is left as it was until the host restores the result.
    let all = format!(
        "{records}{record}
"
    );
    ok(unsafe { lowline_engine_choose(engine, s(&all), &mut len) });
    let chosen = result(len);
    assert_eq!(chosen["settled"], 41);
    ok(unsafe { lowline_engine_stale(engine, &mut len) });
    assert_eq!(
        result(len),
        Value::Null,
        "41 is less than a tenth more than 40"
    );
    ok(unsafe { lowline_engine_restore(engine, s(&chosen.to_string())) });

    // Started again from storage — the records with the new one, then the tuning — it answers the same.
    let restarted = self::engine();
    let all = format!("{records}{record}\n");
    ok(unsafe { lowline_engine_learn(restarted, s(&all)) });
    ok(unsafe { lowline_engine_restore(restarted, s(&tuning.to_string())) });
    ok(unsafe { lowline_engine_stale(restarted, &mut len) });
    assert_eq!(result(len), Value::Null);
    assert_eq!(
        propose(restarted, &json!({ "customer": "Beta" }), ""),
        shown
    );

    unsafe {
        lowline_engine_free(engine);
        lowline_engine_free(restarted);
        lowline_engine_free(ptr::null_mut());
    }
}

#[test]
fn a_form_written_in_formdown_reads_from_its_schema() {
    let definition = json!({
        "name": "intake",
        "formdown": {
            "customer": { "type": "text" },
            "owner": { "type": "select", "options": [{ "value": "kim" }, { "value": "lee" }] }
        }
    })
    .to_string();
    let mut engine = ptr::null_mut();
    ok(unsafe { lowline_engine_new(s(&definition), &mut engine) });
    let shown = propose(engine, &json!({ "customer": "Acme" }), "");
    assert_eq!(shown[0]["field"], "owner");
    // No record yet: the decider asks for a judgement from outside the records, and says what it would read.
    assert_eq!(shown[0]["abstain"], "needs-judgement");
    assert_eq!(shown[0]["asks"], json!([["customer", "Acme"]]));
    unsafe { lowline_engine_free(engine) };
}

#[test]
fn refusals_come_back_as_a_status_and_a_message_before_anything_changes() {
    let mut out = ptr::null_mut();
    assert_eq!(
        unsafe { lowline_engine_new(s("{"), &mut out) },
        LOWLINE_INVALID_INPUT
    );
    assert!(last_error().starts_with("definition does not read"));
    assert!(out.is_null());
    let no_decided = r#"{"name":"x","form":{"fields":[{"name":"note","kind":"text"}]}}"#;
    assert_eq!(
        unsafe { lowline_engine_new(s(no_decided), &mut out) },
        LOWLINE_INVALID_INPUT
    );
    assert!(!last_error().is_empty());
    let both = r#"{"name":"x","form":{"fields":[]},"formdown":{}}"#;
    assert_eq!(
        unsafe { lowline_engine_new(s(both), &mut out) },
        LOWLINE_INVALID_INPUT
    );
    assert!(out.is_null());

    let engine = engine();
    let foreign = r#"{"id":"r","settled_at":0,"values":{"colour":"red"}}"#;
    assert_eq!(
        unsafe { lowline_engine_learn(engine, s(foreign)) },
        LOWLINE_INVALID_INPUT
    );
    assert_eq!(
        last_error(),
        "record 'r' has a value for 'colour', which the form does not have"
    );
    assert_eq!(unsafe { lowline_engine_settled(engine) }, 0);
    let cut = "\n{\"id\":";
    assert_eq!(
        unsafe { lowline_engine_learn(engine, s(cut)) },
        LOWLINE_INVALID_INPUT
    );
    assert!(last_error().starts_with("record line 2 does not read"));
    // Refused, not broken: the engine still takes calls.
    ok(unsafe { lowline_engine_learn(engine, NONE) });
    unsafe { lowline_engine_free(engine) };
}

#[test]
fn a_malformed_call_never_reaches_the_engine() {
    assert_eq!(
        unsafe { lowline_engine_new(s(DEFINITION), ptr::null_mut()) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(last_error(), "out is null");
    assert_eq!(
        unsafe { lowline_engine_learn(ptr::null_mut(), NONE) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(last_error(), "engine is null");

    let engine = engine();
    let dangling = LowlineStr {
        ptr: ptr::null(),
        len: 3,
    };
    assert_eq!(
        unsafe { lowline_engine_learn(engine, dangling) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(last_error(), "records is null but its length is 3");
    let not_utf8 = [0xffu8, 0xfe];
    let bytes = LowlineStr {
        ptr: not_utf8.as_ptr(),
        len: 2,
    };
    assert_eq!(
        unsafe { lowline_engine_learn(engine, bytes) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(last_error(), "records is not UTF-8");
    let mut len = 0;
    assert_eq!(
        unsafe { lowline_engine_settle(engine, s("r"), s("{}"), NONE, 7, 0, &mut len) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { lowline_engine_stale(engine, ptr::null_mut()) },
        LOWLINE_INVALID_ARGUMENT
    );
    assert_eq!(last_error(), "result_len is null");
    assert_eq!(unsafe { lowline_engine_settled(engine) }, 0);
    unsafe { lowline_engine_free(engine) };
}

#[test]
fn a_form_is_filled_from_what_the_host_model_said() {
    let engine = engine();
    let mut len = 0;
    let values = json!({ "customer": "Acme" }).to_string();
    ok(unsafe { lowline_engine_describe(engine, s(&values), s(r#"{"owner":["lee"]}"#), &mut len) });
    assert_eq!(
        result(len),
        json!([{ "name": "owner", "kind": "choice", "choices": ["lee"] }])
    );

    let answered = json!({ "owner": "lee", "customer": "Beta" }).to_string();
    ok(unsafe { lowline_engine_fill(engine, s(&values), NONE, s(&answered), &mut len) });
    let shown = result(len);
    assert_eq!(
        shown.as_array().unwrap().len(),
        1,
        "the customer already holds a value"
    );
    assert_eq!(
        shown[0]["suggestion"],
        json!({ "value": "lee", "origin": "other", "fit": "exact" })
    );
    assert_eq!(shown[0]["prefill"], false);

    let wrong = json!({ "owner": "park" }).to_string();
    ok(unsafe { lowline_engine_fill(engine, s(&values), NONE, s(&wrong), &mut len) });
    assert_eq!(result(len)[0]["abstain"], "not-a-choice");
    unsafe { lowline_engine_free(engine) };
}
