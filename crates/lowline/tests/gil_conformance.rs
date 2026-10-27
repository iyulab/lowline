//! The engine settles as the Gil decider expects: every case of the decider's conformance fixture — what a host
//! reported for one decided field, the value saved, who saved it — gives the settlement, the record line and the
//! usage counts the fixture holds, and every boundary of a tuning going stale is where the fixture puts it. The
//! fixture is the decider's, computed with the published release named in it.
#![cfg(all(feature = "gil", feature = "serde"))]

use std::collections::BTreeMap;

use lowline::{
    Draft, Field, FieldValue, Form, Inference, Proposal, ResolvedField, Role, SettledBy,
    Suggestion, gil as engine,
};
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/gil-settlement-conformance.json")).unwrap()
}

/// The form of a case: an observed `subject` and the decided `field`, taking several values when the case saves several.
fn fields(several: bool) -> Vec<ResolvedField> {
    let mut field = Field::choice("field", ["A", "B", "a", "b"]);
    field.role = Some(Role::Decided);
    field.multiple = several;
    let mut subject = Field::new("subject", lowline::FieldKind::Text);
    subject.role = Some(Role::Observed);
    Form {
        fields: vec![field, subject],
    }
    .resolve(Inference::DeclaredOnly)
    .unwrap()
}

fn value(json: &Value) -> Option<FieldValue> {
    match json {
        Value::Null => None,
        Value::String(one) => Some(FieldValue::from(one.as_str())),
        Value::Array(many) => Some(FieldValue::Many(
            many.iter()
                .map(|v| v.as_str().unwrap().to_owned())
                .collect(),
        )),
        other => panic!("not a value: {other}"),
    }
}

/// Counts that are not zero, as numbers.
fn counted(usage: &Value) -> BTreeMap<String, f64> {
    usage
        .as_object()
        .unwrap()
        .iter()
        .filter_map(|(name, n)| n.as_f64().filter(|n| *n != 0.0).map(|n| (name.clone(), n)))
        .collect()
}

#[test]
fn every_settlement_case_settles_as_the_decider_expects() {
    let fixture = fixture();
    let cases = fixture["settlements"].as_array().unwrap();
    assert_eq!(cases.len(), 24);
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let saved = value(&case["saved"]);
        let fields = fields(matches!(case["saved"], Value::Array(_)));

        // The draft, from the steps the host reported; the proposal last in view, or held back for a check.
        let mut draft = Draft::new();
        let mut proposal = Proposal::abstain("field", lowline::Abstain::NoEvidence);
        for step in case["steps"].as_array().unwrap() {
            if let Some(opened) = step.get("open") {
                draft = Draft::reopen([("field", value(opened).unwrap())]);
            } else if let Some(shown) = step.get("show") {
                let suggestion: Suggestion = serde_json::from_value(shown.clone()).unwrap();
                draft.show("field", suggestion.clone());
                proposal = Proposal::suggest(
                    "field",
                    suggestion,
                    None,
                    Vec::new(),
                    lowline::Policy::Offer,
                );
            } else if step.get("decline").is_some() {
                assert!(draft.decline("field"), "{id}: nothing in view to turn down");
            } else if let Some(p) = step.get("hold") {
                draft.hold("field", p.as_f64().unwrap());
            } else {
                panic!("{id}: unknown step {step}");
            }
        }

        let mut values = BTreeMap::from([("subject".to_owned(), FieldValue::from("x"))]);
        if let Some(saved) = saved {
            values.insert("field".to_owned(), saved);
        }
        let by = match case["settled_by"].as_str().unwrap() {
            "person" => SettledBy::Person,
            _ => SettledBy::Application,
        };
        let settled = draft.settle(["field"], &values, by);

        let expected = &case["settlement"];
        if expected.is_null() {
            assert!(
                settled.is_empty(),
                "{id}: expected nothing, settled {settled:?}"
            );
            continue;
        }
        let [settlement] = settled.as_slice() else {
            panic!("{id}: expected one settlement, got {settled:?}");
        };
        let gil_kind: gil::schema::SettlementKind = settlement.kind.into();
        assert_eq!(json!(gil_kind), expected["kind"], "{id}: kind");
        assert_eq!(json!(settlement.value), expected["value"], "{id}: value");
        assert_eq!(json!(settlement.values), expected["values"], "{id}: values");
        assert_eq!(
            settlement.probability.unwrap_or(1.0),
            expected["probability"].as_f64().unwrap(),
            "{id}: probability"
        );

        // The record line Gil keeps.
        let settled_at = case["gil"]["record"]["settled_at"].as_i64().unwrap();
        let record = engine::record("r1", &fields, &values, &settled, settled_at);
        assert_eq!(json!(record), case["gil"]["record"], "{id}: record line");

        // The usage counts of this one decision, compared with the answer in view or held back.
        let counts = gil::usage::usage(&[engine::decision(&proposal, Some(settlement))]);
        let usage = serde_json::to_value(&counts["field"]).unwrap();
        assert_eq!(
            counted(&usage),
            counted(&case["gil"]["usage"]),
            "{id}: usage"
        );
    }
}

#[test]
fn a_tuning_goes_stale_where_the_decider_says() {
    let fixture = fixture();
    let fields = fields(false);
    let schema = engine::schema("form", &fields).unwrap();
    for case in fixture["stale"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let expected = &case["stale"];
        let found = if let (Some(chosen), Some(now)) =
            (case["chosen_on"].as_u64(), case["settled_now"].as_u64())
        {
            let tuning = gil::tuning::Tuning::capture(&schema, chosen as usize, 0.8);
            tuning.stale(&schema, now as usize)
        } else {
            let tuning = gil::tuning::Tuning::capture(&schema, 100, 0.8);
            let first = |change: fn(&mut gil::schema::Attribute)| {
                let mut attributes = schema.attributes().to_vec();
                change(&mut attributes[0]);
                gil::schema::Schema::new(schema.name(), attributes).unwrap()
            };
            let changed = match id {
                "threshold-changed" => first(|a| {
                    a.key_threshold = Some(0.5);
                    a.memory_threshold = Some(0.5);
                }),
                "candidates-changed" => first(|a| a.candidates = Some(vec!["A".to_owned()])),
                "field-added" => {
                    let mut more = fields.clone();
                    more.extend(
                        Form {
                            fields: vec![{
                                let mut extra = Field::new("extra", lowline::FieldKind::Text);
                                extra.role = Some(Role::Observed);
                                extra
                            }],
                        }
                        .resolve(Inference::DeclaredOnly)
                        .unwrap(),
                    );
                    engine::schema("form", &more).unwrap()
                }
                "version-changed" => {
                    let old = gil::tuning::Tuning {
                        version: "0.6.0".to_owned(),
                        ..tuning.clone()
                    };
                    assert_eq!(json!(old.stale(&schema, 100)), *expected, "{id}");
                    continue;
                }
                other => panic!("unknown change {other}"),
            };
            tuning.stale(&changed, 100)
        };
        assert_eq!(json!(found), *expected, "{id}");
    }
}
