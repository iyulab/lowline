//! How long choosing thresholds takes on a large history, step by step as `tune` takes them — run with
//! `LOWLINE_TUNE_COST=1 cargo test --release -p lowline --all-features --test tune_cost -- --nocapture`.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;
use std::time::Instant;

use lowline::gil::{self as engine, Engine, Tune};
use lowline::{Draft, Field, FieldKind, FieldValue, Form, Role, SettledBy};

const THINGS: [&str; 10] = [
    "laptop", "monitor", "payslip", "leave", "badge", "printer", "mail", "card", "course", "chair",
];
const TROUBLES: [&str; 6] = [
    "is broken",
    "again please",
    "does not work",
    "to change",
    "a question",
    "is slow",
];
const DEPARTMENTS: [&str; 5] = ["sales", "dev", "people", "finance", "ops"];
const OWNERS: [&str; 4] = ["it", "people", "finance", "facilities"];

#[test]
fn measures_choosing_thresholds_on_ten_thousand_records() {
    if std::env::var("LOWLINE_TUNE_COST").as_deref() != Ok("1") {
        return;
    }
    let mut owner = Field::new("owner", FieldKind::Choice);
    owner.open = true;
    owner.role = Some(Role::Decided);
    let form = Form {
        fields: vec![
            Field::new("request", FieldKind::Text),
            Field::new("department", FieldKind::Text),
            owner,
            Field::new("urgent", FieldKind::Flag),
        ],
    };
    let fields = form.resolve(lowline::Inference::DeclaredOnly).unwrap();
    let engine = Engine::new("intake", fields.clone(), Tune::default()).unwrap();
    // A small deterministic generator: the same records every run.
    let mut seed = 7u64;
    let mut next = |n: usize| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) as usize) % n
    };
    let records: Vec<_> = (0..10_000)
        .map(|i| {
            let thing = next(THINGS.len());
            let saved = BTreeMap::from([
                (
                    "request".to_owned(),
                    FieldValue::from(
                        format!("{} {} ({i})", THINGS[thing], TROUBLES[next(TROUBLES.len())])
                            .as_str(),
                    ),
                ),
                (
                    "department".to_owned(),
                    FieldValue::from(DEPARTMENTS[next(DEPARTMENTS.len())]),
                ),
                (
                    "owner".to_owned(),
                    FieldValue::from(OWNERS[thing % OWNERS.len()]),
                ),
                (
                    "urgent".to_owned(),
                    FieldValue::from(if next(5) == 0 { "true" } else { "false" }),
                ),
            ]);
            let settled = Draft::new().settle(["owner"], &saved, SettledBy::Person);
            engine::record(&format!("r{i}"), &fields, &saved, &settled, i as i64 * 37)
        })
        .collect();

    let mut schema = engine.schema().clone();
    let choice = gil::replay::Choice {
        target_precision: 0.8,
        minimum_answered: 10,
        counting: Some(engine::COUNTED),
    };
    let at = Instant::now();
    let concentrations = gil::replay::select_key_concentrations(
        &mut gil::key_memory::KeyMemory::default(),
        &schema,
        "owner",
        &records,
    );
    let t1 = at.elapsed();
    schema = changed(&schema, |a| a.key_concentrations = concentrations);
    let at = Instant::now();
    let keyed = gil::replay::select_key_fields(&schema, "owner", &records, choice, 0);
    let t2 = at.elapsed();
    schema = changed(&schema, |a| a.key_fields = keyed.key_fields.clone());
    let at = Instant::now();
    let _layers = gil::replay::select_layers(
        &mut gil::key_memory::KeyMemory::default(),
        &mut gil::lexical_memory::LexicalMemory::default(),
        &schema,
        "owner",
        &records,
        choice,
        gil::replay::LayerOptions {
            rule: gil::replay::ThresholdRule::EveryBand,
            ..Default::default()
        },
    );
    let t3 = at.elapsed();
    let at = Instant::now();
    let mut whole = engine.schema().clone();
    engine::tune(&mut whole, &fields, &records, &Tune::default());
    let t4 = at.elapsed();
    eprintln!(
        "10000 records · concentrations {} ms · key fields {} ms ({} trials) · layers {} ms · tune as a whole {} ms",
        t1.as_millis(),
        t2.as_millis(),
        keyed.trials.len(),
        t3.as_millis(),
        t4.as_millis()
    );

    // Learning them all, as a host does at start-up — and one of them again, as after an edit.
    let mut learner = Engine::new("intake", fields.clone(), Tune::default()).unwrap();
    let at = Instant::now();
    learner.learn(&records);
    let all = at.elapsed();
    let at = Instant::now();
    learner.learn(&records[..1]);
    let one = at.elapsed();
    #[cfg(feature = "serde")]
    {
        let lines: Vec<String> = records
            .iter()
            .map(|r| serde_json::to_string(r).unwrap())
            .collect();
        let at = Instant::now();
        let read: Vec<gil::schema::Record> = lines
            .iter()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        eprintln!(
            "10000 records · read from JSON lines {} ms",
            at.elapsed().as_millis()
        );
        assert_eq!(read.len(), records.len());
    }
    eprintln!(
        "10000 records · learn all {} ms · learn one again {} ms",
        all.as_millis(),
        one.as_millis()
    );
}

/// `schema` with `change` made to its `owner` attribute.
fn changed(
    schema: &gil::schema::Schema,
    change: impl FnOnce(&mut gil::schema::Attribute),
) -> gil::schema::Schema {
    let mut attributes = schema.attributes().to_vec();
    change(attributes.iter_mut().find(|a| a.name == "owner").unwrap());
    gil::schema::Schema::new(schema.name(), attributes).unwrap()
}
