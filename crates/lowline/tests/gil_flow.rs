//! A host's round with the Gil decider, end to end: the form handed over, records learned, a field answered and
//! shown, the person's save settled and handed back, and what the answers came to counted.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use lowline::gil::{Engine, Stale};
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
    let mut intake = Engine::new("intake", fields, engine::Tune::default()).unwrap();
    let history = alternating(&intake, 40);
    intake.tune(&history);

    // A new record for a known customer: the owner is answered and shown.
    let typed = saved(&[("customer", "Acme")]);
    let shown = intake.propose("new", &typed, &BTreeMap::new());
    let suggestion = shown[0].suggestion.clone().expect("the records back kim");
    assert_eq!(suggestion.value, "kim");
    assert!(shown[0].prefill);

    // The person takes it and saves: the record to store says so, and the engine has learned it.
    let mut draft = Draft::new();
    draft.show("owner", suggestion);
    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let stored = intake.settle("new", &values, &draft, SettledBy::Person, 40);
    assert_eq!(
        stored.settlements["owner"],
        gil::schema::SettlementKind::Accept
    );
    assert_eq!(intake.settled(), 41);

    let settled = draft.settle(["owner"], &values, SettledBy::Person);
    let counts = gil::usage::usage([engine::decision(&shown[0], settled.first())]);
    assert_eq!((counts["owner"].answered, counts["owner"].accepted), (1, 1));
}

/// `n` records settled by a person with nothing in view: Acme's owner is kim, Beta's is lee.
fn alternating(intake: &Engine, n: i64) -> Vec<gil::schema::Record> {
    (0..n)
        .map(|i| {
            let (customer, owner) = if i % 2 == 0 {
                ("Acme", "kim")
            } else {
                ("Beta", "lee")
            };
            let values = saved(&[("customer", customer), ("owner", owner)]);
            let settled = Draft::new().settle(["owner"], &values, SettledBy::Person);
            engine::record(&format!("r{i}"), intake.fields(), &values, &settled, i)
        })
        .collect()
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

#[test]
fn thresholds_are_chosen_on_the_records_and_chosen_again_when_they_grow() {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut intake = Engine::new("intake", fields.clone(), engine::Tune::default()).unwrap();
    let records = alternating(&intake, 40);

    // With no tuning, nothing is trusted.
    intake.learn(&records);
    assert_eq!(intake.stale(), Some(Stale::Untuned));
    let typed = saved(&[("customer", "Beta")]);
    assert_eq!(
        intake.propose("new", &typed, &BTreeMap::new())[0].suggestion,
        None
    );

    let tuning = intake.tune(&records).clone();
    assert!(intake.schema().attributes[1].key_threshold.is_some());
    assert_eq!(tuning.settled, 40);
    assert!(tuning.attributes[0].key_promise.is_some());
    assert_eq!(intake.stale(), None);
    let shown = intake.propose("new", &typed, &BTreeMap::new());
    assert_eq!(
        shown[0].suggestion.as_ref().map(|s| s.value.as_str()),
        Some("lee")
    );

    // Learning a record again replaces it; four new ones are a tenth more, and the tuning no longer stands.
    intake.learn(&records[..1]);
    assert_eq!(intake.settled(), 40);
    for i in 40..44 {
        let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
        intake.settle(
            &format!("r{i}"),
            &values,
            &Draft::new(),
            SettledBy::Person,
            i,
        );
    }
    assert!(matches!(intake.stale(), Some(Stale::Tuning(_))));

    // An engine started again from storage — its records, then its tuning — answers the same, the tuning standing.
    let mut restarted = Engine::new("intake", fields, engine::Tune::default()).unwrap();
    restarted.learn(&records);
    restarted.restore(Some(tuning));
    assert_eq!(restarted.stale(), None);
    assert_eq!(
        restarted.schema().attributes[1].key_threshold,
        intake.schema().attributes[1].key_threshold
    );
    assert_eq!(restarted.propose("new", &typed, &BTreeMap::new()), shown);
}

#[test]
fn a_value_this_person_may_not_pick_is_not_suggested() {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut intake = Engine::new("intake", fields, engine::Tune::default()).unwrap();
    let records = alternating(&intake, 40);
    intake.tune(&records);

    let typed = saved(&[("customer", "Acme")]);
    let allowed = BTreeMap::from([("owner".to_owned(), vec!["lee".to_owned()])]);
    let shown = intake.propose("new", &typed, &allowed);
    assert_eq!(shown[0].suggestion, None);
    assert_eq!(shown[0].abstain, Some(lowline::Abstain::NotAllowed));
}

#[test]
fn values_taken_from_suggestions_do_not_grade_the_suggestions() {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut schema = engine::schema("intake", &fields).unwrap();
    // Every value taken from a suggestion: none counts, so no threshold can be chosen on them.
    let records: Vec<_> = (0..40)
        .map(|i| {
            let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
            let mut draft = Draft::new();
            draft.show("owner", lowline::Suggestion::new("kim"));
            let settled = draft.settle(["owner"], &values, SettledBy::Person);
            engine::record(&format!("r{i}"), &fields, &values, &settled, i)
        })
        .collect();
    engine::tune(&mut schema, &records, &engine::Tune::default());
    assert_eq!(schema.attributes[1].key_threshold, None);
}
