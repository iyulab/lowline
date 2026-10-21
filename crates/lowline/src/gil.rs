//! The engine's form and settlements in the decider's vocabulary — [Gil](https://crates.io/crates/iyulab-gil).
//!
//! A host that answers with Gil hands it the [`gil::schema::Schema`] made from the resolved form ([`schema`]) and, when
//! a record is saved, the settlement of each decided field ([`Settlement::to_gil`]).

use crate::policy::Policy;
use crate::provenance::{Settlement, SettlementKind};
use crate::schema::{FieldKind, ResolvedField, Role};

/// The Gil schema named `name` for a resolved form, checked as Gil checks one.
///
/// Each field becomes an attribute in the form's order: its role, whether it is evidence, its policy, and — for a
/// decided field that takes one value — the choices of a closed choice field as its candidates, its coarse level and
/// the values it must not miss. A decided field that takes several values takes several in Gil. An observed field
/// that takes several is one attribute whose value is the field's values together, as one clue: Gil takes several
/// values only for a decided attribute. A field's parent is not handed over — Gil learns from the records which values
/// go with which.
///
/// The error is Gil's, naming the first rule the form breaks for it — a form with no decided field among them.
pub fn schema(name: &str, fields: &[ResolvedField]) -> Result<gil::schema::Schema, String> {
    let schema = gil::schema::Schema {
        name: name.to_owned(),
        attributes: fields.iter().map(attribute).collect(),
    };
    schema.check()?;
    Ok(schema)
}

fn attribute(resolved: &ResolvedField) -> gil::schema::Attribute {
    let field = &resolved.field;
    let decided = resolved.role == Role::Decided;
    let decided_one = decided && !field.multiple;
    let mut attribute = gil::schema::Attribute::new(
        &field.name,
        match resolved.role {
            Role::Decided => gil::schema::AttributeRole::Decided,
            Role::Observed => gil::schema::AttributeRole::Observed,
        },
    );
    attribute.multiple = decided && field.multiple;
    attribute.use_as_evidence = resolved.evidence;
    attribute.policy = match resolved.policy {
        Policy::Offer => gil::schema::AttributePolicy::Suggest,
        Policy::Confirm => gil::schema::AttributePolicy::ConfirmRequired,
        Policy::Off => gil::schema::AttributePolicy::Off,
    };
    if decided && field.kind == FieldKind::Choice && field.is_closed_choice() {
        attribute.candidates = Some(field.choices.clone());
    }
    if decided_one {
        attribute.coarse = field
            .coarse
            .filter(|prefix| *prefix > 0)
            .map(|prefix| gil::schema::CoarseLevel::by_prefix(prefix as usize));
        if !field.must_catch.is_empty() {
            attribute.must_catch = Some(field.must_catch.clone());
        }
    }
    attribute
}

impl From<SettlementKind> for gil::schema::SettlementKind {
    fn from(kind: SettlementKind) -> Self {
        match kind {
            SettlementKind::Accept => Self::Accept,
            SettlementKind::Correct => Self::Correct,
            SettlementKind::Reject => Self::Reject,
            SettlementKind::Revert => Self::Revert,
            SettlementKind::Restore => Self::Restore,
            SettlementKind::Set => Self::Set,
            SettlementKind::Enter => Self::Enter,
            SettlementKind::Fill => Self::Fill,
            SettlementKind::AcceptOther => Self::AcceptOther,
            SettlementKind::CorrectOther => Self::CorrectOther,
        }
    }
}

impl Settlement {
    /// This settlement as Gil takes it for the field's attribute. A field that takes several values is settled — or
    /// restored — with its set of values.
    pub fn to_gil(&self) -> gil::schema::Settlement {
        use gil::schema::Settlement as Gil;
        let value = self.value.as_deref().unwrap_or_default();
        let values = || self.values.iter().flatten().map(String::as_str);
        match self.kind {
            SettlementKind::Accept => Gil::accept(value),
            SettlementKind::Correct => Gil::correct(value),
            SettlementKind::AcceptOther => Gil::accept_other(value),
            SettlementKind::CorrectOther => Gil::correct_other(value),
            SettlementKind::Enter => Gil::enter(value),
            SettlementKind::Fill => Gil::fill(value),
            SettlementKind::Reject => Gil::reject(),
            SettlementKind::Revert => Gil::revert(),
            SettlementKind::Set => Gil::set(values()),
            SettlementKind::Restore if self.values.is_some() => Gil::restore_set(values()),
            SettlementKind::Restore => Gil::restore(value),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::provenance::{Draft, SettledBy, Suggestion};
    use crate::schema::{Field, Form, Inference};
    use crate::value::FieldValue;
    use gil::schema::{AttributePolicy, AttributeRole};

    fn resolved(fields: Vec<Field>) -> Vec<ResolvedField> {
        Form { fields }.resolve(Inference::ClosedChoices).unwrap()
    }

    #[test]
    fn hands_a_form_over_as_a_gil_schema() {
        let mut code = Field::choice("code", ["P10", "P11", "Q20"]);
        code.coarse = Some(1);
        code.must_catch = vec!["Q20".into()];
        code.policy = Some(Policy::Confirm);
        let mut name = Field::new("name", FieldKind::Text);
        name.evidence = Some(false);
        let mut tags = Field::choice("tags", ["x", "y"]);
        tags.multiple = true;
        tags.role = Some(Role::Observed);
        let schema = schema(
            "intake",
            &resolved(vec![Field::new("note", FieldKind::Text), name, code, tags]),
        )
        .unwrap();

        assert_eq!(schema.name, "intake");
        let by = |n: &str| schema.attributes.iter().find(|a| a.name == n).unwrap();
        assert_eq!(by("note").role, AttributeRole::Observed);
        assert!(!by("name").use_as_evidence);
        let code = by("code");
        assert_eq!(code.role, AttributeRole::Decided);
        assert_eq!(code.policy, AttributePolicy::ConfirmRequired);
        assert_eq!(
            code.candidates.as_deref(),
            Some(&["P10".to_owned(), "P11".into(), "Q20".into()][..])
        );
        assert_eq!(code.coarse.as_ref().map(|c| c.prefix), Some(1));
        assert_eq!(code.must_catch.as_deref(), Some(&["Q20".to_owned()][..]));
        // Gil takes several values only for a decided attribute.
        assert!(!by("tags").multiple);
        assert_eq!(
            schema
                .attributes
                .iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>(),
            ["note", "name", "code", "tags"]
        );
    }

    #[test]
    fn a_decided_field_of_several_values_takes_several_and_no_candidates_when_open() {
        let mut topics = Field::choice("topics", ["a", "b"]);
        topics.multiple = true;
        topics.role = Some(Role::Decided);
        let mut owner = Field::choice("owner", ["kim", "lee"]);
        owner.open = true;
        owner.role = Some(Role::Decided);
        let schema = schema("f", &resolved(vec![topics, owner])).unwrap();
        assert!(schema.attributes[0].multiple);
        assert!(schema.attributes[0].coarse.is_none());
        assert!(schema.attributes[1].candidates.is_none());
    }

    #[test]
    fn says_why_gil_will_not_take_a_form() {
        let error = schema("f", &resolved(vec![Field::new("note", FieldKind::Text)])).unwrap_err();
        assert!(error.contains("decided"), "{error}");
    }

    #[test]
    fn settles_each_kind_in_gil_s_words() {
        let mut draft = Draft::reopen([
            ("kept", FieldValue::from("x")),
            ("set", FieldValue::Many(vec!["b".into(), "a".into()])),
        ]);
        draft.show("taken", Suggestion::new("a"));
        draft.show("changed", Suggestion::new("a"));
        draft.show("model", Suggestion::other("m"));
        draft.show("turned", Suggestion::new("a"));
        draft.decline("turned");
        let saved: BTreeMap<String, FieldValue> = [
            ("taken", FieldValue::from("a")),
            ("changed", FieldValue::from("b")),
            ("model", FieldValue::from("m")),
            ("typed", FieldValue::from("t")),
            ("kept", FieldValue::from("x")),
            ("set", FieldValue::Many(vec!["a".into(), "b".into()])),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        let gil: BTreeMap<String, gil::schema::Settlement> = draft
            .settle(
                [
                    "taken", "changed", "model", "typed", "turned", "kept", "set",
                ],
                &saved,
                SettledBy::Person,
            )
            .iter()
            .map(|s| (s.field.clone(), s.to_gil()))
            .collect();

        use gil::schema::Settlement as G;
        assert_eq!(gil["taken"], G::accept("a"));
        assert_eq!(gil["changed"], G::correct("b"));
        assert_eq!(gil["model"], G::accept_other("m"));
        assert_eq!(gil["typed"], G::enter("t"));
        assert_eq!(gil["turned"], G::reject());
        assert_eq!(gil["kept"], G::restore("x"));
        assert_eq!(gil["set"], G::restore_set(["a", "b"]));
    }

    #[test]
    fn every_kind_has_its_gil_name() {
        for kind in [
            SettlementKind::Accept,
            SettlementKind::Correct,
            SettlementKind::Reject,
            SettlementKind::Revert,
            SettlementKind::Restore,
            SettlementKind::Set,
            SettlementKind::Enter,
            SettlementKind::Fill,
            SettlementKind::AcceptOther,
            SettlementKind::CorrectOther,
        ] {
            let gil: gil::schema::SettlementKind = kind.into();
            assert_eq!(format!("{gil:?}"), format!("{kind:?}"));
        }
    }
}
