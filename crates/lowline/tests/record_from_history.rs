//! A host whose records are kept somewhere of its own builds the engine's store from them: each record made into the
//! line to store, nothing learned until the lines are handed over together.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use lowline::gil::{Engine, Tune};
use lowline::{Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, SettlementKind};

fn engine() -> Engine {
    let mut tags = Field::choice("tags", ["urgent", "billing", "repeat"]);
    tags.multiple = true;
    tags.role = Some(lowline::Role::Decided);
    let mut owner = Field::choice("owner", ["kim", "lee"]);
    owner.role = Some(lowline::Role::Decided);
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            owner,
            tags,
        ],
    };
    Engine::new(
        "intake",
        form.resolve(Inference::ClosedChoices).unwrap(),
        Tune::default(),
    )
    .unwrap()
}

fn saved() -> BTreeMap<String, FieldValue> {
    BTreeMap::from([
        ("customer".to_owned(), FieldValue::from("Acme")),
        ("owner".to_owned(), FieldValue::from("kim")),
        (
            "tags".to_owned(),
            FieldValue::Many(vec!["urgent".to_owned()]),
        ),
    ])
}

#[test]
fn a_record_with_nothing_said_of_it_is_the_record_a_person_saved_with_nothing_in_view() {
    let mut engine = engine();
    let made = engine.record("r1", &saved(), &BTreeMap::new(), 5).unwrap();
    assert_eq!(engine.settled(), 0, "nothing is learned");
    let settled = engine.settle("r1", &saved(), &Draft::new(), SettledBy::Person, 5);
    assert_eq!(
        serde_json::to_value(&made).unwrap(),
        serde_json::to_value(&settled).unwrap()
    );
    assert_eq!(
        made.settlements["owner"],
        gil::schema::SettlementKind::Enter
    );
    assert_eq!(made.settlements["tags"], gil::schema::SettlementKind::Set);
}

#[test]
fn how_a_field_was_settled_is_kept() {
    let engine = engine();
    let settled = BTreeMap::from([("owner".to_owned(), SettlementKind::Accept)]);
    let made = engine.record("r1", &saved(), &settled, 5).unwrap();
    assert_eq!(
        made.settlements["owner"],
        gil::schema::SettlementKind::Accept
    );

    // An empty field is not settled, whatever is said of it.
    let mut empty = saved();
    empty.remove("owner");
    let made = engine.record("r2", &empty, &settled, 6).unwrap();
    assert!(!made.settlements.contains_key("owner"));
}

#[test]
fn what_the_form_does_not_hold_is_refused() {
    let engine = engine();
    let mut stray = saved();
    stray.insert("note".to_owned(), FieldValue::from("x"));
    assert!(
        engine
            .record("r1", &stray, &BTreeMap::new(), 1)
            .unwrap_err()
            .contains("'note'")
    );

    let mut several = saved();
    several.insert(
        "owner".to_owned(),
        FieldValue::Many(vec!["kim".to_owned(), "lee".to_owned()]),
    );
    assert!(
        engine
            .record("r1", &several, &BTreeMap::new(), 1)
            .unwrap_err()
            .contains("takes one")
    );

    let observed = BTreeMap::from([("customer".to_owned(), SettlementKind::Enter)]);
    assert!(
        engine
            .record("r1", &saved(), &observed, 1)
            .unwrap_err()
            .contains("does not decide")
    );

    let check = BTreeMap::from([("owner".to_owned(), SettlementKind::Check)]);
    assert!(
        engine
            .record("r1", &saved(), &check, 1)
            .unwrap_err()
            .contains("check")
    );
}
