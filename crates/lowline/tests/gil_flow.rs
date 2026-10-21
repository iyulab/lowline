//! A host's round with the Gil decider, end to end: the form handed over, records learned, a field answered and
//! shown, the person's save settled and handed back, and what the answers came to counted.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use gil::decider::Decider;
use gil::key_memory::KeyMemory;
use lowline::{Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, gil as engine};

fn saved(pairs: &[(&str, &str)]) -> BTreeMap<String, FieldValue> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), FieldValue::from(*v)))
        .collect()
}

#[test]
fn a_record_is_answered_shown_settled_and_learned_from() {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut schema = engine::schema("intake", &fields).unwrap();
    // The host's tuning sets the thresholds; any score trusts here.
    schema.attributes[1].key_threshold = Some(0.0);

    let mut decider = Decider::new(KeyMemory::default(), None);
    let history: Vec<_> = (0..5)
        .map(|i| {
            let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
            let settled = Draft::new().settle(["owner"], &values, SettledBy::Person);
            engine::record(&format!("r{i}"), &fields, &values, &settled, i)
        })
        .collect();
    decider.rebuild(&schema, &history);

    // A new record for the same customer: the owner is answered and shown.
    let typed = BTreeMap::from([("customer".to_owned(), "Acme".to_owned())]);
    let answers = decider.answer(&schema, "new", &typed, &BTreeMap::new());
    let shown = engine::proposal(&fields[1], &answers[0], None);
    let suggestion = shown.suggestion.clone().expect("the records back kim");
    assert_eq!(suggestion.value, "kim");
    assert!(shown.prefill);

    let mut draft = Draft::new();
    draft.show("owner", suggestion);
    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let settled = draft.settle(["owner"], &values, SettledBy::Person);
    let record = engine::record("new", &fields, &values, &settled, 5);
    assert_eq!(
        record.settlements["owner"],
        gil::schema::SettlementKind::Accept
    );
    decider.rebuild(&schema, &[record]);

    let counts = gil::usage::usage([engine::decision(&shown, settled.first())]);
    assert_eq!((counts["owner"].answered, counts["owner"].accepted), (1, 1));
}

#[test]
fn an_observed_field_of_several_values_is_one_clue() {
    let mut tags = Field::choice("tags", ["b", "a"]);
    tags.multiple = true;
    tags.role = Some(lowline::Role::Observed);
    let mut owner = Field::choice("owner", ["kim", "lee"]);
    owner.role = Some(lowline::Role::Decided);
    let fields = Form {
        fields: vec![tags, owner],
    }
    .resolve(Inference::ClosedChoices)
    .unwrap();

    let values = BTreeMap::from([
        (
            "tags".to_owned(),
            FieldValue::Many(vec!["b".into(), "a".into(), "b".into()]),
        ),
        ("owner".to_owned(), FieldValue::from("kim")),
    ]);
    let record = engine::record("r", &fields, &values, &[], 0);
    assert_eq!(record.values["tags"], "a, b");
    assert!(record.sets.is_empty());
}
