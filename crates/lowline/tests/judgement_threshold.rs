//! A judgement from outside the records — the host's model — is trusted by the model's own measure until the records say
//! how often it was right. The score it gave is kept on the record of the case, and once enough cases are settled the
//! engine chooses the score from which the judgement is trusted, with the precision to expect of it.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use gil::decider::ExternalCandidate;
use gil::schema::Record;
use lowline::gil::Engine;
use lowline::{
    Draft, Field, FieldKind, FieldValue, Form, Inference, Layer, SettledBy, gil as engine,
};

fn saved(pairs: &[(&str, &str)]) -> BTreeMap<String, FieldValue> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), FieldValue::from(*v)))
        .collect()
}

fn intake() -> Engine {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    Engine::new("intake", fields, engine::Tune::default()).unwrap()
}

/// What the model says of `owner` for a case: always "kim", with `score`, trusted by its own measure.
fn model(score: f64, trusted: bool) -> [ExternalCandidate; 1] {
    [ExternalCandidate {
        value: "kim".to_owned(),
        probability: score,
        trusted,
    }]
}

/// A case where the model's answer is shown and a person settles it: taken when `right`, else corrected to "lee".
fn judged(intake: &mut Engine, n: i64, score: f64, right: bool) -> Record {
    let id = format!("c{n}");
    // A customer no other case has, so the records have nothing to say and only the judgement answers.
    let values = saved(&[("customer", &format!("customer-{n}"))]);
    let shown = intake
        .offer(&id, &values, &BTreeMap::new(), "owner", &model(score, true))
        .expect("the owner is open");
    assert_eq!(shown.layer, Some(Layer::Judgement));
    let mut draft = Draft::new();
    assert!(draft.show_proposed(&shown));
    let owner = if right { "kim" } else { "lee" };
    let settled = saved(&[("customer", &format!("customer-{n}")), ("owner", owner)]);
    intake
        .settle(&id, &settled, &draft, SettledBy::Person, n)
        .unwrap()
}

/// Sixty cases: the model is right whenever it is sure (score 0.9) and wrong half the time when it is not (0.3).
fn history(intake: &mut Engine) -> Vec<Record> {
    (0..60)
        .map(|n| match n % 3 {
            0 | 1 => judged(intake, n, 0.9, true),
            _ => judged(intake, n, 0.3, n % 2 == 0),
        })
        .collect()
}

#[test]
fn the_score_of_a_judgement_in_view_is_kept_on_the_record() {
    let mut intake = intake();
    let record = judged(&mut intake, 0, 0.9, true);
    assert_eq!(record.scores.get("owner"), Some(&0.9));
    assert_eq!(
        record.sources.get("owner"),
        Some(&gil::decider::Source::External)
    );

    // An answer the records gave carries no score: it is the judge's own scale, and the records have no such scale.
    let mut learned = engine_with_records();
    let values = saved(&[("customer", "Acme")]);
    let shown = learned.propose("new", &values, &BTreeMap::new())[0].clone();
    let mut draft = Draft::new();
    assert!(draft.show_proposed(&shown));
    let record = learned
        .settle(
            "new",
            &saved(&[("customer", "Acme"), ("owner", "kim")]),
            &draft,
            SettledBy::Person,
            99,
        )
        .unwrap();
    assert!(record.scores.is_empty());
}

fn engine_with_records() -> Engine {
    let mut intake = intake();
    let records: Vec<Record> = (0..40)
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
    intake.tune(&records);
    intake
}

#[test]
fn before_the_records_say_how_often_the_judgement_was_right_it_is_trusted_by_its_own_measure() {
    let intake = intake();
    let shown = intake
        .offer(
            "new",
            &saved(&[("customer", "Gamma")]),
            &BTreeMap::new(),
            "owner",
            &model(0.3, true),
        )
        .unwrap();
    assert_eq!(
        shown.suggestion.as_ref().map(|s| s.value.as_str()),
        Some("kim")
    );
    assert_eq!(shown.promise, None, "nothing has measured it");
    assert_eq!(shown.score, Some(0.3));

    // Not trusted by the model, not shown.
    let shown = intake
        .offer(
            "new",
            &saved(&[("customer", "Gamma")]),
            &BTreeMap::new(),
            "owner",
            &model(0.9, false),
        )
        .unwrap();
    assert_eq!(shown.suggestion, None);
}

#[test]
fn the_engine_chooses_the_score_from_which_the_judgement_is_trusted_and_promises_by_it() {
    let mut intake = intake();
    let records = history(&mut intake);
    let tuned = intake.tune(&records).clone();

    let report = tuned.report.iter().find(|r| r.field == "owner").unwrap();
    let chosen = report
        .judgement
        .as_ref()
        .expect("sixty judged cases are enough to choose a score");
    assert!(
        chosen.threshold > 0.3 && chosen.threshold <= 0.9,
        "{chosen:?}"
    );
    assert!(chosen.promise >= 0.8, "{chosen:?}");

    // The model is sure: trusted by the chosen score whatever the model said of itself, with the promise beside it.
    let values = saved(&[("customer", "Gamma")]);
    let sure = intake
        .offer("a", &values, &BTreeMap::new(), "owner", &model(0.9, false))
        .unwrap();
    assert_eq!(
        sure.suggestion.as_ref().map(|s| s.value.as_str()),
        Some("kim")
    );
    assert_eq!(sure.promise, Some(chosen.promise));
    assert_eq!(sure.score, Some(0.9));

    // The model is unsure: not shown, though the model trusted itself.
    let unsure = intake
        .offer("b", &values, &BTreeMap::new(), "owner", &model(0.3, true))
        .unwrap();
    assert_eq!(unsure.suggestion, None);
}

#[test]
fn a_chosen_score_survives_a_restart() {
    let mut intake = intake();
    let records = history(&mut intake);
    let tuned = intake.tune(&records).clone();

    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut restarted = Engine::new("intake", fields, engine::Tune::default()).unwrap();
    restarted.learn(&records);
    restarted.restore(Some(tuned.clone()));
    assert_eq!(restarted.report(), intake.report());
    let values = saved(&[("customer", "Gamma")]);
    let sure = restarted
        .offer("a", &values, &BTreeMap::new(), "owner", &model(0.9, false))
        .unwrap();
    assert!(sure.suggestion.is_some());
    assert!(sure.promise.is_some());
}
