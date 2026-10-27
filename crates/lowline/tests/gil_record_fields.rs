//! What a settled record carries beyond how each field was settled: the answer in view with its layer and promise, the
//! time each field took, who settled it, the order its values arrived in, its batch and the form's version.
#![cfg(all(feature = "gil", feature = "serde"))]

use std::collections::BTreeMap;

use lowline::gil::Engine;
use lowline::{
    Audit, Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, gil as engine,
};

fn saved(pairs: &[(&str, &str)]) -> BTreeMap<String, FieldValue> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), FieldValue::from(*v)))
        .collect()
}

/// An engine for a customer and its owner, with forty settled records and its thresholds chosen.
fn intake() -> Engine {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut intake = Engine::new("intake", fields, engine::Tune::default())
        .unwrap()
        .with_form_version("owners-2");
    let history: Vec<gil::schema::Record> = (0..40)
        .map(|n| {
            let (customer, owner) = if n % 2 == 0 {
                ("Acme", "kim")
            } else {
                ("Beta", "lee")
            };
            let values = saved(&[("customer", customer), ("owner", owner)]);
            let settled = Draft::new().settle(["owner"], &values, SettledBy::Person);
            engine::record(&format!("h{n}"), intake.fields(), &values, &settled, n)
        })
        .collect();
    intake.tune(&history);
    intake
}

#[test]
fn a_person_taking_an_answer_leaves_what_was_in_view_and_what_the_draft_reported() {
    let mut intake = intake();
    let typed = saved(&[("customer", "Acme")]);
    let shown = intake.propose("new", &typed, &BTreeMap::new());
    let proposal = &shown[0];
    assert_eq!(proposal.suggestion.as_ref().unwrap().value, "kim");

    let mut draft = Draft::new();
    draft.open_at(1_000);
    draft.arrived("customer");
    draft.reach("owner", 4_000);
    assert!(draft.show_proposed(proposal));
    draft.reach("owner", 4_500); // only the first report counts
    draft.arrived("owner");
    draft.save_at(6_500);
    draft.settled_by("person-7");
    draft.in_batch("import-3");

    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let stored = intake
        .settle("new", &values, &draft, SettledBy::Person, 40)
        .unwrap();

    assert_eq!(stored.suggested["owner"], "kim");
    assert_eq!(stored.sources["owner"], gil::decider::Source::KeyMemory);
    assert_eq!(stored.promises.get("owner"), proposal.promise.as_ref());
    assert_eq!(stored.settle_ms["owner"], 2_500);
    assert_eq!(stored.open_ms, Some(5_500));
    assert_eq!(stored.settled_by["owner"], "person-7");
    assert_eq!(
        stored.arrival.as_deref(),
        Some(&["customer".to_owned(), "owner".to_owned()][..])
    );
    assert_eq!(stored.batch.as_deref(), Some("import-3"));
    assert_eq!(stored.form_version.as_deref(), Some("owners-2"));

    // Gil counts the line it is handed back the same as the decision the engine would have built.
    let from_line = gil::usage::usage(std::slice::from_ref(&stored));
    let settlements = draft.settle(["owner"], &values, SettledBy::Person);
    let from_decision = gil::usage::usage(&[engine::decision(proposal, settlements.first())]);
    assert_eq!(
        (
            from_line["owner"].answered,
            from_line["owner"].accepted,
            from_line["owner"].promised
        ),
        (
            from_decision["owner"].answered,
            from_decision["owner"].accepted,
            from_decision["owner"].promised
        )
    );
}

#[test]
fn a_draft_that_reported_nothing_adds_nothing_to_the_line() {
    let mut intake = intake();
    let values = saved(&[("customer", "Acme"), ("owner", "lee")]);
    let stored = intake
        .settle("plain", &values, &Draft::new(), SettledBy::Person, 41)
        .unwrap();
    assert!(stored.suggested.is_empty() && stored.sources.is_empty() && stored.promises.is_empty());
    assert!(stored.settle_ms.is_empty() && stored.settled_by.is_empty());
    assert_eq!(
        (stored.open_ms, stored.arrival, stored.batch),
        (None, None, None)
    );
}

#[test]
fn a_show_without_a_layer_writes_no_layer() {
    let mut intake = intake();
    let mut draft = Draft::new();
    draft.show("owner", lowline::Suggestion::new("kim"));
    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let stored = intake
        .settle("old-host", &values, &draft, SettledBy::Person, 42)
        .unwrap();
    assert_eq!(stored.suggested["owner"], "kim");
    assert!(stored.sources.is_empty() && stored.promises.is_empty());
}

#[test]
fn a_check_keeps_the_answer_the_person_was_not_shown() {
    let mut intake = intake();
    let typed = saved(&[("customer", "Acme")]);
    let shown = intake.propose("chk", &typed, &BTreeMap::new());
    let proposal = &shown[0];

    let mut draft = Draft::new();
    assert!(draft.hold_proposed(proposal, 0.25));
    draft.reach("owner", 100);
    draft.save_at(900);
    draft.settled_by("person-2");
    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let stored = intake
        .settle("chk", &values, &draft, SettledBy::Person, 43)
        .unwrap();

    assert_eq!(
        stored.settlements["owner"],
        gil::schema::SettlementKind::Check
    );
    assert_eq!(stored.probabilities["owner"], 0.25);
    assert_eq!(stored.suggested["owner"], "kim");
    assert_eq!(stored.sources["owner"], gil::decider::Source::KeyMemory);
    assert_eq!(stored.settle_ms["owner"], 800);

    let counts = gil::usage::usage(&[stored]);
    let owner = &counts["owner"];
    assert_eq!((owner.checked, owner.checked_right), (1, 1));
    assert_eq!(owner.judged_weight, 4.0);
}

#[test]
fn the_application_settling_on_its_own_names_nobody_and_shows_nothing() {
    let mut intake = intake();
    let mut draft = Draft::new();
    draft.settled_by("importer");
    draft.in_batch("file-9");
    let values = saved(&[("customer", "Beta"), ("owner", "lee")]);
    let stored = intake
        .settle("imp", &values, &draft, SettledBy::Application, 44)
        .unwrap();
    assert!(stored.suggested.is_empty() && stored.settled_by.is_empty());
    assert_eq!(stored.batch.as_deref(), Some("file-9"));
}

#[test]
fn the_draft_reads_and_writes_the_new_parts_and_leaves_them_out_when_empty() {
    assert_eq!(
        serde_json::to_value(Draft::new()).unwrap(),
        serde_json::json!({ "opened": {}, "fields": {} })
    );
    let mut draft = Draft::new();
    draft.open_at(1);
    draft.save_at(9);
    draft.reach("owner", 3);
    draft.arrived("owner");
    draft.settled_by("p");
    draft.in_batch("b");
    let json = serde_json::to_value(&draft).unwrap();
    assert_eq!(json["opened_at"], 1);
    assert_eq!(json["saved_at"], 9);
    assert_eq!(json["fields"]["owner"]["at"], 3);
    assert_eq!(json["arrival"], serde_json::json!(["owner"]));
    assert_eq!(
        (json["by"].as_str(), json["batch"].as_str()),
        (Some("p"), Some("b"))
    );
    let back: Draft = serde_json::from_value(json).unwrap();
    assert_eq!(back, draft);
}

#[test]
fn a_record_drawn_for_audit_is_settled_again_by_another_person_as_checks() {
    let audit = Audit { rate: 0.1 };
    assert_eq!(audit.draw(0.05), Some(0.1));
    assert_eq!(audit.draw(0.1), None);
    assert_eq!(Audit::default().draw(0.0), None);

    let mut intake = intake();
    let values = saved(&[("customer", "Acme"), ("owner", "kim")]);
    let first = intake
        .settle(
            "a-1",
            &values,
            &{
                let mut d = Draft::new();
                d.settled_by("person-1");
                d
            },
            SettledBy::Person,
            50,
        )
        .unwrap();
    assert_eq!(first.settled_by["owner"], "person-1");

    // Drawn: the record is opened with nothing, the decider's answer held back, and a second person settles it.
    let q = audit.draw(0.01).unwrap();
    let proposal = intake
        .propose("a-1", &saved(&[("customer", "Acme")]), &BTreeMap::new())
        .remove(0);
    let mut again = Draft::new();
    assert!(again.hold_proposed(&proposal, q));
    again.settled_by("person-2");
    let second = intake
        .settle("a-1", &values, &again, SettledBy::Person, 99)
        .unwrap();

    assert_eq!(second.id, first.id);
    assert!(second.settled_at > first.settled_at);
    assert_eq!(
        second.settlements["owner"],
        gil::schema::SettlementKind::Check
    );
    assert_eq!(second.probabilities["owner"], 0.1);
    assert_eq!(second.settled_by["owner"], "person-2");
    assert_eq!(second.suggested["owner"], "kim");
    let owner = &gil::usage::usage(&[first, second])["owner"];
    assert_eq!((owner.checked, owner.checked_right), (1, 1));
}
