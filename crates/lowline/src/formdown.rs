//! Reading a form written in formdown: the JSON its `getSchema()` gives, into a [`Form`].

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::policy::Policy;
use crate::schema::{Field, FieldKind, Form, Role};

/// The schema formdown's `getSchema()` gives for a form: one entry per field, keyed by name. Only what bears on
/// suggesting is read; the rest of each entry is passed over.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(transparent)]
pub struct FormdownSchema(BTreeMap<String, FormdownField>);

/// One entry of a [`FormdownSchema`].
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormdownField {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    options: Vec<FormdownOption>,
    #[serde(default)]
    allow_other: bool,
    #[serde(default)]
    required: bool,
    compute: Option<String>,
    relation: Option<serde::de::IgnoredAny>,
    suggest: Option<FormdownSuggest>,
    position: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct FormdownOption {
    value: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormdownSuggest {
    role: Option<FormdownRole>,
    policy: Option<Policy>,
    evidence: Option<bool>,
    parent: Option<String>,
    coarse: Option<u32>,
    #[serde(default)]
    must_catch: Vec<String>,
    together: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FormdownRole {
    Judged,
    Observed,
}

impl From<FormdownSchema> for Form {
    /// The fields in the form's order. Buttons and file fields hold no value to suggest and are left out; a type
    /// formdown has but the engine does not tell apart (an email, a colour) is text.
    fn from(schema: FormdownSchema) -> Self {
        let mut entries: Vec<_> = schema.0.into_iter().collect();
        entries.sort_by_key(|(_, field)| field.position.unwrap_or(u64::MAX));
        Form {
            fields: entries
                .into_iter()
                .filter_map(|(name, field)| field.into_field(name))
                .collect(),
        }
    }
}

impl FormdownField {
    fn into_field(self, name: String) -> Option<Field> {
        let has_options = !self.options.is_empty();
        let kind = match self.kind.as_str() {
            "submit" | "reset" | "button" | "image" | "file" => return None,
            _ if self.relation.is_some() => FieldKind::Reference,
            "select" | "radio" => FieldKind::Choice,
            "checkbox" if has_options => FieldKind::Choice,
            "checkbox" => FieldKind::Flag,
            "number" | "range" => FieldKind::Number,
            "date" | "time" | "datetime-local" | "month" | "week" => FieldKind::Date,
            _ => FieldKind::Text,
        };
        let suggest = self.suggest.unwrap_or_default();
        let mut field = Field::new(name, kind);
        if kind == FieldKind::Choice {
            field.choices = self.options.into_iter().map(|o| o.value).collect();
            field.open = self.allow_other;
            field.multiple = self.kind == "checkbox";
        }
        field.required = self.required;
        field.computed = self.compute.is_some();
        field.role = suggest.role.map(|role| match role {
            FormdownRole::Judged => Role::Decided,
            FormdownRole::Observed => Role::Observed,
        });
        field.policy = suggest.policy;
        // A password is never a clue for anything.
        field.evidence = suggest
            .evidence
            .or((self.kind == "password").then_some(false));
        field.parent = suggest.parent;
        field.coarse = suggest.coarse;
        field.must_catch = suggest.must_catch;
        field.together = suggest.together;
        Some(field)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Inference;

    /// `getSchema()` of a form exercising every kind, as formdown writes it.
    const SCHEMA: &str = include_str!("../tests/fixtures/formdown-schema.json");

    fn form() -> Form {
        serde_json::from_str::<FormdownSchema>(SCHEMA)
            .unwrap()
            .into()
    }

    #[test]
    fn fields_come_in_the_forms_order_without_buttons_or_files() {
        let names: Vec<_> = form().fields.into_iter().map(|f| f.name).collect();
        assert_eq!(
            names,
            [
                "received",
                "customer",
                "summary",
                "channel",
                "handler",
                "fault_code",
                "tags",
                "urgent",
                "quantity",
                "price",
                "amount"
            ]
        );
    }

    #[test]
    fn kinds_and_choices_are_read() {
        let form = form();
        let get = |name: &str| form.fields.iter().find(|f| f.name == name).unwrap();
        assert_eq!(get("received").kind, FieldKind::Date);
        assert!(get("received").required);
        assert_eq!(get("customer").kind, FieldKind::Reference);
        assert_eq!(get("summary").kind, FieldKind::Text);
        let channel = get("channel");
        assert_eq!(
            (channel.kind, channel.open, channel.multiple),
            (FieldKind::Choice, true, false)
        );
        assert_eq!(channel.choices, ["phone", "mail"]);
        let tags = get("tags");
        assert_eq!((tags.kind, tags.multiple), (FieldKind::Choice, true));
        assert_eq!(get("urgent").kind, FieldKind::Flag);
        assert_eq!(get("quantity").kind, FieldKind::Number);
        assert!(get("amount").computed);
    }

    #[test]
    fn what_the_form_says_about_suggesting_is_read() {
        let form = form();
        let get = |name: &str| form.fields.iter().find(|f| f.name == name).unwrap();
        let handler = get("handler");
        assert_eq!(
            (handler.role, handler.policy),
            (Some(Role::Decided), Some(Policy::Confirm))
        );
        assert_eq!(handler.must_catch, ["park"]);
        let code = get("fault_code");
        assert_eq!(
            (code.coarse, code.parent.as_deref()),
            (Some(2), Some("handler"))
        );
        assert_eq!(get("customer").evidence, Some(false));
    }

    #[test]
    fn fields_settled_together_are_read() {
        let schema: FormdownSchema = serde_json::from_str(
            r#"{
                "industry": {"type": "select", "position": 1, "options": [{"value": "a"}], "suggest": {"together": "coding"}},
                "occupation": {"type": "select", "position": 2, "options": [{"value": "x"}], "suggest": {"together": "coding"}}
            }"#,
        )
        .unwrap();
        let form = Form::from(schema);
        assert!(
            form.fields
                .iter()
                .all(|f| f.together.as_deref() == Some("coding"))
        );
    }

    #[test]
    fn a_form_that_declares_roles_is_taken_at_its_word() {
        let resolved = form().resolve(Inference::ClosedChoices).unwrap();
        let decided: Vec<_> = resolved
            .iter()
            .filter(|r| r.role == Role::Decided)
            .map(|r| r.field.name.as_str())
            .collect();
        assert_eq!(decided, ["handler", "fault_code"]);
    }

    #[test]
    fn without_declarations_closed_choices_are_decided() {
        let schema: FormdownSchema = serde_json::from_str(
            r#"{
                "kind": {"type": "radio", "position": 2, "options": [{"value": "a"}, {"value": "b"}]},
                "agree": {"type": "checkbox", "position": 3},
                "name": {"type": "text", "position": 1},
                "secret": {"type": "password", "position": 4}
            }"#,
        )
        .unwrap();
        let resolved = Form::from(schema)
            .resolve(Inference::ClosedChoices)
            .unwrap();
        let roles: Vec<_> = resolved
            .iter()
            .map(|r| (r.field.name.as_str(), r.role, r.evidence))
            .collect();
        assert_eq!(
            roles,
            [
                ("name", Role::Observed, true),
                ("kind", Role::Decided, true),
                ("agree", Role::Observed, true),
                ("secret", Role::Observed, false)
            ]
        );
    }
}
