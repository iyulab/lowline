//! `tune` chooses every threshold the decider answers with — the fields that key a decided field, how readily their
//! keys are believed, its thresholds while typing and its class's — and a field asked for while typed into is held to
//! the threshold for that many characters.
#![cfg(feature = "gil")]

use std::collections::BTreeMap;

use lowline::gil::{Engine, Tune};
use lowline::{
    Abstain, Draft, Field, FieldKind, FieldValue, Fit, Form, Inference, Role, SettledBy,
    gil as engine,
};

fn saved(pairs: &[(&str, String)]) -> BTreeMap<String, FieldValue> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), FieldValue::from(v.as_str())))
        .collect()
}

fn decided(mut field: Field) -> Field {
    field.role = Some(Role::Decided);
    field
}

/// Records settled by a person with nothing in view, in settlement order.
fn history(
    engine: &Engine,
    n: usize,
    values: impl Fn(usize) -> Vec<(&'static str, String)>,
) -> Vec<gil::schema::Record> {
    let decided: Vec<String> = engine
        .fields()
        .iter()
        .filter(|f| f.role == Role::Decided)
        .map(|f| f.field.name.clone())
        .collect();
    (0..n)
        .map(|i| {
            let saved = saved(&values(i));
            let settled = Draft::new().settle(
                decided.iter().map(String::as_str),
                &saved,
                SettledBy::Person,
            );
            engine::record(
                &format!("r{i}"),
                engine.fields(),
                &saved,
                &settled,
                i as i64,
            )
        })
        .collect()
}

fn attribute<'a>(engine: &'a Engine, name: &str) -> &'a gil::schema::Attribute {
    engine
        .schema()
        .attributes()
        .iter()
        .find(|a| a.name == name)
        .unwrap()
}

#[test]
fn a_field_naming_what_is_decided_is_believed_at_once() {
    // The shop decides who inspects it; its district mostly goes to one inspector, but three shops in ten of each
    // district go to another — keyed by the district too, those shops' visits lean the wrong way.
    let form = Form {
        fields: vec![
            Field::new("shop", FieldKind::Text),
            Field::choice("district", ["north", "south", "east"]),
            decided(Field::new("inspector", FieldKind::Text)),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("inspections", fields, Tune::default()).unwrap();
    let records = history(&engine, 300, |i| {
        let shop = (i * 7) % 60;
        let district = shop % 3;
        let inspector = if shop % 10 < 7 {
            district
        } else {
            3 + district
        };
        vec![
            ("shop", format!("shop-{shop}")),
            ("district", ["north", "south", "east"][district].to_owned()),
            ("inspector", format!("inspector-{inspector}")),
        ]
    });
    engine.tune(&records);

    // The shop's keys are believed at once — each points at one inspector — the district's slowly, so a shop that
    // goes against its district is answered its own inspector.
    let inspector = attribute(&engine, "inspector");
    assert!(inspector.key_concentrations["shop"] < 0.01);
    assert!(inspector.key_concentrations["district"] > inspector.key_concentrations["shop"]);
    assert!(inspector.key_threshold.is_some());
    let values = saved(&[
        ("shop", "shop-7".to_owned()),
        ("district", "south".to_owned()),
    ]);
    let shown = engine
        .propose_field("new", &values, &BTreeMap::new(), "inspector", None)
        .unwrap();
    assert_eq!(
        shown.suggestion.map(|s| s.value).as_deref(),
        Some("inspector-4")
    );
    let tuned = &engine.tuning().unwrap().attributes;
    let kept = tuned.iter().find(|a| a.attribute == "inspector").unwrap();
    assert_eq!(kept.key_concentrations, inspector.key_concentrations);
}

#[test]
fn a_class_is_suggested_where_its_value_cannot_be() {
    // Every fault code is new, but its chapter follows the department.
    let mut code = decided(Field::new("code", FieldKind::Text));
    code.coarse = Some(1);
    let form = Form {
        fields: vec![Field::choice("department", ["engines", "cabin"]), code],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("faults", fields, Tune::default()).unwrap();
    let records = history(&engine, 120, |i| {
        let (department, chapter) = if i % 2 == 0 {
            ("engines", "E")
        } else {
            ("cabin", "C")
        };
        vec![
            ("department", department.to_owned()),
            ("code", format!("{chapter}{i:03}")),
        ]
    });
    engine.tune(&records);

    let coarse = attribute(&engine, "code").coarse.as_ref().unwrap();
    assert!(coarse.key_threshold.is_some());
    let values = saved(&[("department", "engines".to_owned())]);
    let shown = engine
        .propose_field("new", &values, &BTreeMap::new(), "code", None)
        .unwrap();
    let suggestion = shown.suggestion.expect("the chapter is known");
    assert_eq!(
        (suggestion.value.as_str(), suggestion.fit),
        ("E", Fit::Prefix)
    );
    let report = engine.report().unwrap();
    let class = report
        .iter()
        .find(|r| r.field == "code")
        .unwrap()
        .coarse
        .clone()
        .unwrap();
    assert_eq!(shown.promise, Some(class.promise));
}

#[test]
fn typing_narrows_a_field_to_the_values_that_begin_with_it() {
    // Acme's contact is Kim six times in ten and Lee the rest: too mixed to answer before typing, plain once typed.
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("channel", ["phone", "mail"]),
            decided(Field::new("contact", FieldKind::Text)),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("calls", fields, Tune::default()).unwrap();
    let records = history(&engine, 200, |i| {
        vec![
            ("customer", "Acme".to_owned()),
            ("channel", ["phone", "mail"][i % 2].to_owned()),
            ("contact", if i % 10 < 6 { "Kim" } else { "Lee" }.to_owned()),
        ]
    });
    engine.tune(&records);

    let contact = attribute(&engine, "contact");
    assert_eq!(contact.typed_key_thresholds.as_ref().map(Vec::len), Some(3));
    assert_eq!(
        contact.key_threshold, None,
        "Kim six in ten is below the target"
    );
    let values = saved(&[
        ("customer", "Acme".to_owned()),
        ("channel", "phone".to_owned()),
    ]);
    let typed = engine
        .propose_field("new", &values, &BTreeMap::new(), "contact", Some("L"))
        .unwrap();
    assert_eq!(typed.suggestion.map(|s| s.value).as_deref(), Some("Lee"));
    // Its promise is the one-character threshold's, not the key threshold's (there is none).
    let report = engine.report().unwrap();
    let one = report
        .iter()
        .find(|r| r.field == "contact")
        .unwrap()
        .typed
        .as_ref()
        .unwrap()[0]
        .clone()
        .unwrap();
    assert_eq!(typed.promise, Some(one.promise));
    // Past the lengths chosen for, typing answers nothing.
    let long = engine
        .propose_field("new", &values, &BTreeMap::new(), "contact", Some("Leeds"))
        .unwrap();
    assert_eq!(long.abstain, Some(Abstain::Unsure));
}

#[test]
fn a_field_picked_from_choices_is_answered_nothing_while_typed_into() {
    let form = Form {
        fields: vec![
            Field::new("customer", FieldKind::Text),
            Field::choice("owner", ["kim", "lee"]),
        ],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("intake", fields, Tune::default()).unwrap();
    let records = history(&engine, 40, |i| {
        vec![
            ("customer", ["Acme", "Beta"][i % 2].to_owned()),
            ("owner", ["kim", "lee"][i % 2].to_owned()),
        ]
    });
    engine.tune(&records);
    assert_eq!(attribute(&engine, "owner").typed_key_thresholds, None);

    let values = saved(&[("customer", "Acme".to_owned())]);
    let untyped = engine
        .propose_field("new", &values, &BTreeMap::new(), "owner", None)
        .unwrap();
    assert_eq!(untyped.suggestion.map(|s| s.value).as_deref(), Some("kim"));
    let typed = engine
        .propose_field("new", &values, &BTreeMap::new(), "owner", Some("k"))
        .unwrap();
    assert_eq!(typed.abstain, Some(Abstain::Unsure));
    // Not a decided field still open.
    assert!(
        engine
            .propose_field("new", &values, &BTreeMap::new(), "customer", None)
            .is_none()
    );
}

#[test]
fn a_class_the_similar_records_back_carries_their_promise() {
    // Every fault code is new and the notes are never the same twice, so no key backs the chapter; the notes are
    // alike within a chapter, so the similar records do.
    let mut code = decided(Field::new("code", FieldKind::Text));
    code.coarse = Some(1);
    let form = Form {
        fields: vec![Field::new("note", FieldKind::Text), code],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("faults", fields, Tune::default()).unwrap();
    let engines = [
        "hydraulic pump pressure low",
        "engine oil leak near gasket",
        "turbine blade vibration high",
    ];
    let cabin = [
        "seat belt buckle torn",
        "cabin lamp flickering overhead",
        "galley oven door latch stuck",
    ];
    let records = history(&engine, 400, |i| {
        let (note, chapter) = if i % 2 == 0 {
            (engines[(i / 2) % 3], "E")
        } else {
            (cabin[(i / 2) % 3], "C")
        };
        vec![
            ("note", format!("{note} ref {i:03}")),
            ("code", format!("{chapter}{i:03}")),
        ]
    });
    engine.tune(&records);

    let report = engine
        .report()
        .unwrap()
        .iter()
        .find(|r| r.field == "code")
        .unwrap()
        .clone();
    let class = report
        .coarse_similar
        .expect("the similar records are trusted for the class");
    assert!(
        report.coarse.is_none(),
        "no key backs the class, so the key layer promises none"
    );

    let values = saved(&[("note", "hydraulic pump pressure low ref 242".to_owned())]);
    let shown = engine
        .propose_field("new", &values, &BTreeMap::new(), "code", None)
        .unwrap();
    let suggestion = shown.suggestion.as_ref().expect("the chapter is backed");
    assert_eq!(
        (suggestion.value.as_str(), suggestion.fit, shown.layer),
        ("E", Fit::Prefix, Some(lowline::Layer::Similar))
    );
    assert_eq!(shown.promise, Some(class.promise));

    // A tuning stored before the similar records could promise a class is chosen again, not trusted without a promise.
    let mut stored = engine.choose(&records);
    for field in &mut stored.report {
        field.coarse_similar = None;
    }
    let mut again = Engine::new("faults", engine.fields().to_vec(), Tune::default()).unwrap();
    again.learn(&records);
    again.restore(Some(stored));
    assert_eq!(again.stale(), Some(lowline::gil::Stale::Untuned));
}

#[test]
fn a_declared_field_taking_several_values_is_suggested_on_every_value_settled() {
    // A person settles a set whether or not a suggestion was in view, so nothing is left to count on but every value
    // settled: the default count would never see it, and the field would show nothing however regular the records.
    let mut tags = decided(Field::choice("tags", ["a", "b"]));
    tags.multiple = true;
    let form = Form {
        fields: vec![Field::new("customer", FieldKind::Text), tags],
    };
    let fields = form.resolve(Inference::ClosedChoices).unwrap();
    let mut engine = Engine::new("tagged", fields, Tune::default()).unwrap();
    let decided_fields = ["tags"];
    let records: Vec<_> = (0..60)
        .map(|i| {
            let saved: BTreeMap<String, FieldValue> = [
                (
                    "customer".to_owned(),
                    FieldValue::from(format!("c{}", i % 6).as_str()),
                ),
                (
                    "tags".to_owned(),
                    FieldValue::Many(vec![if i % 6 < 3 { "a" } else { "b" }.to_owned()]),
                ),
            ]
            .into();
            let settled = Draft::new().settle(decided_fields, &saved, SettledBy::Person);
            engine::record(
                &format!("r{i}"),
                engine.fields(),
                &saved,
                &settled,
                i as i64,
            )
        })
        .collect();
    engine.tune(&records);

    let report = &engine.report().unwrap()[0];
    assert_eq!(report.counting, lowline::gil::Counting::Settled);
    assert!(report.key.is_some());
    let values = saved(&[("customer", "c1".to_owned())]);
    let shown = engine
        .propose_field("new", &values, &BTreeMap::new(), "tags", None)
        .unwrap();
    assert!(shown.several, "a set cannot be drawn for a check");
    assert_eq!(shown.suggestion.map(|s| s.value).as_deref(), Some("a"));
}
