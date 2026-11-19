//! A field answered from thresholds measured on records kept elsewhere — a prior — until its own records choose
//! thresholds that stand.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use lowline::gil::{Engine, Prior, PriorRefused, Stale};
use lowline::{Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, gil as engine};

fn saved(pairs: &[(&str, &str)]) -> BTreeMap<String, FieldValue> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), FieldValue::from(*v)))
        .collect()
}

/// Two decided fields: the owner follows the customer, the region does too.
fn form() -> Form {
    Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
            Field::choice("region", ["north", "south"]),
        ],
    }
}

fn engine_for(form: &Form) -> Engine {
    Engine::new(
        "intake",
        form.resolve(Inference::ClosedChoices).unwrap(),
        engine::Tune::default(),
    )
    .unwrap()
}

/// `n` records settled by a person with nothing in view: Acme is kim's in the north, Beta lee's in the south.
fn records(intake: &Engine, n: i64) -> Vec<gil::schema::Record> {
    (0..n)
        .map(|i| {
            let (customer, owner, region) = if i % 2 == 0 {
                ("Acme", "kim", "north")
            } else {
                ("Beta", "lee", "south")
            };
            let values = saved(&[("customer", customer), ("owner", owner), ("region", region)]);
            let settled = Draft::new().settle(["owner", "region"], &values, SettledBy::Person);
            engine::record(&format!("r{i}"), intake.fields(), &values, &settled, i)
        })
        .collect()
}

/// The owner's thresholds measured on forty records elsewhere.
fn sample() -> Prior {
    let mut elsewhere = engine_for(&form());
    let history = records(&elsewhere, 40);
    elsewhere.tune(&history);
    elsewhere
        .prior("owner", "40 sample records")
        .expect("the owner's thresholds stand on forty records")
}

/// What the decider answers with, field by field: each decided attribute's keys and thresholds.
fn held(engine: &Engine) -> Vec<gil::tuning::AttributeTuning> {
    gil::tuning::Tuning::capture(engine.schema(), 0, 0.0).attributes
}

fn report<'a>(engine: &'a Engine, field: &str) -> &'a engine::FieldReport {
    engine
        .report()
        .expect("reported")
        .iter()
        .find(|r| r.field == field)
        .expect("the field is reported")
}

fn owner_for_acme(engine: &Engine) -> lowline::Proposal {
    let shown = engine.propose("new", &saved(&[("customer", "Acme")]), &BTreeMap::new());
    shown.into_iter().find(|p| p.field == "owner").unwrap()
}

#[test]
fn a_field_with_too_few_records_of_its_own_is_answered_from_the_prior_and_says_so() {
    let prior = sample();
    let mut fresh = engine_for(&form());
    let few = records(&fresh, 4);
    fresh.tune(&few);
    assert!(
        !report(&fresh, "owner").stands(),
        "four records choose no threshold"
    );
    assert_eq!(owner_for_acme(&fresh).suggestion, None);

    fresh.restore_prior(prior.clone()).unwrap();
    let shown = owner_for_acme(&fresh);
    assert_eq!(shown.suggestion.map(|s| s.value).as_deref(), Some("kim"));
    assert_eq!(shown.promise, prior.promises.key);
    assert_eq!(shown.prior.as_deref(), Some("40 sample records"));
    // The report says the field's own thresholds do not stand, and what the prior promises meanwhile.
    let owner = report(&fresh, "owner");
    assert!(!owner.stands());
    assert_eq!(owner.prior.as_ref(), Some(&prior.promises));
}

#[test]
fn an_engine_never_tuned_is_answered_from_the_prior_and_still_asks_to_be_tuned() {
    let mut fresh = engine_for(&form());
    fresh.learn(&records(&fresh, 4));
    fresh.restore(None);
    fresh.restore_prior(sample()).unwrap();
    assert_eq!(
        owner_for_acme(&fresh)
            .suggestion
            .map(|s| s.value)
            .as_deref(),
        Some("kim")
    );
    assert_eq!(fresh.stale(), Some(Stale::Untuned));
    assert!(fresh.tuning().is_none(), "the tuning is the engine's own");
}

#[test]
fn once_the_fields_own_thresholds_stand_the_prior_changes_nothing() {
    let form = form();
    let mut plain = engine_for(&form);
    let history = records(&plain, 40);
    plain.tune(&history);

    let mut with = engine_for(&form);
    with.restore_prior(sample()).unwrap();
    with.tune(&history);

    assert_eq!(held(&with), held(&plain));
    assert_eq!(with.report(), plain.report());
    assert_eq!(owner_for_acme(&with), owner_for_acme(&plain));
    assert_eq!(with.stale(), None);
}

#[test]
fn the_prior_changes_no_other_field() {
    let form = form();
    let mut plain = engine_for(&form);
    let few = records(&plain, 4);
    plain.tune(&few);
    let mut with = engine_for(&form);
    with.tune(&few);
    with.restore_prior(sample()).unwrap();

    let region = |e: &Engine| held(e).into_iter().find(|a| a.attribute == "region");
    assert_eq!(region(&with), region(&plain));
    assert_eq!(report(&with, "region"), report(&plain, "region"));
    let shown = |e: &Engine| {
        e.propose("new", &saved(&[("customer", "Acme")]), &BTreeMap::new())
            .into_iter()
            .find(|p| p.field == "region")
    };
    assert_eq!(shown(&with), shown(&plain));
}

#[test]
fn the_engines_own_choice_and_the_tuning_it_stores_owe_nothing_to_the_prior() {
    let form = form();
    let mut plain = engine_for(&form);
    let few = records(&plain, 4);
    let stored = plain.tune(&few).clone();

    let mut with = engine_for(&form);
    with.restore_prior(sample()).unwrap();
    assert_eq!(with.choose(&few), plain.choose(&few));
    let to_store = with.tune(&few).clone();
    assert_eq!(to_store, stored);
    assert!(to_store.report.iter().all(|r| r.prior.is_none()));
    assert_eq!(with.tuning(), plain.tuning());
}

#[test]
fn the_order_the_tuning_and_the_prior_are_put_back_in_does_not_matter() {
    let form = form();
    let mut chooser = engine_for(&form);
    let few = records(&chooser, 4);
    let stored = chooser.tune(&few).clone();

    let mut prior_first = engine_for(&form);
    prior_first.learn(&few);
    prior_first.restore_prior(sample()).unwrap();
    prior_first.restore(Some(stored.clone()));

    let mut tuning_first = engine_for(&form);
    tuning_first.learn(&few);
    tuning_first.restore(Some(stored.clone()));
    tuning_first.restore_prior(sample()).unwrap();

    assert_eq!(held(&prior_first), held(&tuning_first));
    assert_eq!(prior_first.report(), tuning_first.report());

    // Restored again, as a host does after choosing in the background: still the same.
    tuning_first.restore(Some(stored));
    assert_eq!(held(&prior_first), held(&tuning_first));
    assert_eq!(prior_first.report(), tuning_first.report());
}

#[test]
fn a_choice_that_sets_no_threshold_for_the_field_uses_the_prior_again() {
    let form = form();
    let mut engine = engine_for(&form);
    engine.restore_prior(sample()).unwrap();
    let history = records(&engine, 40);
    engine.tune(&history);
    assert_eq!(report(&engine, "owner").prior, None);

    // Chosen again on too few — the records the host holds now: the prior answers once more.
    let mut fewer = engine_for(&form);
    let few = records(&fewer, 4);
    let stored = fewer.tune(&few).clone();
    engine.restore(Some(stored));
    assert_eq!(
        report(&engine, "owner")
            .prior
            .as_ref()
            .map(|p| p.source.as_str()),
        Some("40 sample records")
    );
}

#[test]
fn records_learned_after_the_prior_answer_as_those_learned_before_it() {
    let form = form();
    let mut before = engine_for(&form);
    let few = records(&before, 4);
    before.learn(&few);
    before.restore_prior(sample()).unwrap();

    let mut after = engine_for(&form);
    after.restore_prior(sample()).unwrap();
    after.learn(&few);

    for customer in ["Acme", "Beta"] {
        let shown =
            |e: &Engine| e.propose("new", &saved(&[("customer", customer)]), &BTreeMap::new());
        assert_eq!(shown(&after), shown(&before));
    }
}

#[test]
fn a_prior_the_engine_cannot_use_is_refused_and_says_which_kind() {
    let mut fresh = engine_for(&form());
    let other_version = Prior {
        gil: "0.0.1".into(),
        ..sample()
    };
    let refused = fresh.restore_prior(other_version).unwrap_err();
    assert_eq!(
        refused,
        PriorRefused::Gil {
            field: "owner".into(),
            measured: "0.0.1".into(),
            current: gil::tuning::VERSION.into(),
        }
    );
    assert!(refused.to_string().contains("Gil 0.0.1"));

    let observed = Prior {
        field: "customer".into(),
        ..sample()
    };
    assert_eq!(
        fresh.restore_prior(observed).unwrap_err(),
        PriorRefused::NotDecided {
            field: "customer".into()
        }
    );

    let unknown = Prior {
        field: "manager".into(),
        ..sample()
    };
    let refused = fresh.restore_prior(unknown).unwrap_err();
    assert_eq!(refused.field(), "manager");
    assert!(refused.to_string().contains("does not decide 'manager'"));

    let renamed = Form {
        fields: vec![
            Field::new("client", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
            Field::choice("region", ["north", "south"]),
        ],
    };
    let mut elsewhere = engine_for(&renamed);
    // Measured on a form whose owner is keyed on the customer, which this form calls the client.
    let keyed_on_customer = Prior {
        key_fields: Some(vec!["customer".into()]),
        ..sample()
    };
    let refused = elsewhere.restore_prior(keyed_on_customer).unwrap_err();
    assert!(
        matches!(&refused, PriorRefused::DoesNotFit { field, why } if field == "owner" && !why.is_empty()),
        "{refused:?}"
    );
    assert!(refused.to_string().contains("does not fit the form"));
    assert!(elsewhere.report().is_none(), "nothing refused is used");
}

#[test]
fn a_refusal_is_plain_data_tagged_by_its_kind() {
    let refused = PriorRefused::Gil {
        field: "owner".into(),
        measured: "0.0.1".into(),
        current: "0.13.1".into(),
    };
    let json = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "kind": "gil", "field": "owner", "measured": "0.0.1", "current": "0.13.1" })
    );
    assert_eq!(
        serde_json::to_value(PriorRefused::NotDecided {
            field: "customer".into()
        })
        .unwrap(),
        serde_json::json!({ "kind": "notDecided", "field": "customer" })
    );
    assert_eq!(
        serde_json::from_value::<PriorRefused>(json).unwrap(),
        refused
    );
}

#[test]
fn a_prior_is_plain_data_a_host_keeps_beside_the_form() {
    let prior = sample();
    let json = serde_json::to_value(&prior).unwrap();
    assert_eq!(json["field"], "owner");
    assert_eq!(json["gil"], gil::tuning::VERSION);
    assert_eq!(json["promises"]["source"], "40 sample records");
    assert_eq!(json["promises"]["records"], 40);
    assert!(json["promises"]["key"].is_number());
    assert!(json["keyThreshold"].is_number());
    assert_eq!(serde_json::from_value::<Prior>(json).unwrap(), prior);
    assert!(
        engine_for(&form()).prior("owner", "none").is_none(),
        "an engine with no thresholds has no prior to give"
    );
}
