//! How many records a field's thresholds take to stand again when a person mostly takes what is suggested, by the
//! rate of answers held back to be checked ([`lowline::Recheck`]). A measurement, not a check: run it with
//! `cargo test --release --features gil --test recheck_measure -- --ignored --nocapture` (minutes in a debug build).
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use lowline::{
    Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, Suggestion, gil as engine,
};

/// A fixed sequence in [0, 1), the same on every run.
struct Rolls(u64);

impl Rolls {
    fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Records of one form whose owner follows the customer nine times in ten, each settled the way a person does when
/// the field shows its answer: taken as it is — or, drawn at `rate`, checked with the answer held back. Thresholds
/// are chosen again every ten records, as the product does. Answers the record count at which the owner field first
/// has a threshold, if it gets one within `limit`.
fn records_until_a_threshold(rate: f64, limit: usize, seed: u64) -> Option<usize> {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee", "park"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut schema = engine::schema("intake", &fields).unwrap();
    let mut rolls = Rolls(seed);
    let mut records = Vec::new();
    for i in 0..limit {
        let customer = ["Acme", "Beta", "Coda"][i % 3];
        let usual = ["kim", "lee", "park"][i % 3];
        let owner = if rolls.next() < 0.9 {
            usual
        } else {
            ["kim", "lee", "park"][(i + 1) % 3]
        };
        let values = BTreeMap::from([
            ("customer".to_owned(), FieldValue::from(customer)),
            ("owner".to_owned(), FieldValue::from(owner)),
        ]);
        let mut draft = Draft::new();
        if rate > 0.0 && rolls.next() < rate {
            draft.hold("owner", rate);
        } else {
            // The usual owner is in view and taken; the person changes it when it is not the one.
            draft.show("owner", Suggestion::new(usual));
        }
        let settled = draft.settle(["owner"], &values, SettledBy::Person);
        records.push(engine::record(
            &format!("r{i}"),
            &fields,
            &values,
            &settled,
            i as i64,
        ));
        if (i + 1) % 10 == 0 {
            engine::tune(&mut schema, &records, &engine::Tune::default());
            if schema.attributes[1].key_threshold.is_some() {
                return Some(i + 1);
            }
        }
    }
    None
}

#[test]
#[ignore = "a measurement; run it with --ignored --nocapture"]
fn records_a_threshold_takes_by_the_recheck_rate() {
    for rate in [0.0, 0.02, 0.05, 0.1] {
        let runs: Vec<Option<usize>> = (1..=20)
            .map(|seed| records_until_a_threshold(rate, 2000, seed))
            .collect();
        let mut stood: Vec<usize> = runs.iter().flatten().copied().collect();
        stood.sort_unstable();
        let median = stood.get(stood.len() / 2).copied();
        println!(
            "rate {rate:.2}: a threshold in {}/20 runs within 2000 records · median {} · fastest {} · slowest {}",
            stood.len(),
            median.map_or("-".to_owned(), |m| m.to_string()),
            stood.first().map_or("-".to_owned(), |m| m.to_string()),
            stood.last().map_or("-".to_owned(), |m| m.to_string()),
        );
    }
}
