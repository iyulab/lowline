//! The form a host hands the engine: its fields, what kind of value each takes, and what the form says about
//! suggesting. One shape whatever the form was written in — formdown, code, or generated from an application model.

use std::collections::BTreeSet;
use std::fmt;

use crate::policy::Policy;

/// What kind of value a field takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum FieldKind {
    /// Free text.
    Text,
    Number,
    /// A date or a time.
    Date,
    /// One of a list of choices, or several of them.
    Choice,
    /// On or off — a single checkbox or a switch.
    Flag,
    /// A record the field names, such as a customer.
    Reference,
}

/// Whether a field is answered by the engine or is a clue for answering others.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Role {
    /// A judgement the records can suggest — who handles it, which class it falls in.
    Decided,
    /// What is written down as it is found — the clues.
    Observed,
}

/// One field as the form declares it. Everything but the name and kind is optional; what is left out the engine
/// works out ([`Form::resolve`]).
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "serde",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct Field {
    pub name: String,
    pub kind: FieldKind,
    /// The choices of a [`FieldKind::Choice`] field, in the form's order.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub choices: Vec<String>,
    /// A choice field that also takes a value outside its choices.
    #[cfg_attr(feature = "serde", serde(default, skip_serializing_if = "is_false"))]
    pub open: bool,
    /// Several values rather than one.
    #[cfg_attr(feature = "serde", serde(default, skip_serializing_if = "is_false"))]
    pub multiple: bool,
    #[cfg_attr(feature = "serde", serde(default, skip_serializing_if = "is_false"))]
    pub required: bool,
    /// Worked out from other fields rather than written — never suggested.
    #[cfg_attr(feature = "serde", serde(default, skip_serializing_if = "is_false"))]
    pub computed: bool,
    /// Declared role; left out, the engine decides ([`Inference`]).
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub role: Option<Role>,
    /// Declared policy. `offer` or `confirm` declares the field decided even without a role; `off` keeps a decided
    /// field from being suggested. Left out, a decided field is [`Policy::Offer`].
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub policy: Option<Policy>,
    /// False keeps the field out of the clues for every other field — an identity such as a name. Left out, true.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub evidence: Option<bool>,
    /// The field whose value this one's choices depend on.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub parent: Option<String>,
    /// How many leading characters of a value name its broader class — the chapter of a fault code. Where the value
    /// cannot be suggested, its class may be.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub coarse: Option<u32>,
    /// Values that must not be missed: where one of them is the answer, the host asks rather than stays quiet. On a
    /// choice field, each is one of its choices.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub must_catch: Vec<String>,
}

#[cfg(feature = "serde")]
fn is_false(b: &bool) -> bool {
    !*b
}

impl Field {
    /// A field of this kind with nothing else declared.
    pub fn new(name: impl Into<String>, kind: FieldKind) -> Self {
        Self {
            name: name.into(),
            kind,
            choices: Vec::new(),
            open: false,
            multiple: false,
            required: false,
            computed: false,
            role: None,
            policy: None,
            evidence: None,
            parent: None,
            coarse: None,
            must_catch: Vec::new(),
        }
    }

    /// A choice field with these choices.
    pub fn choice<S: Into<String>>(
        name: impl Into<String>,
        choices: impl IntoIterator<Item = S>,
    ) -> Self {
        Self {
            choices: choices.into_iter().map(Into::into).collect(),
            ..Self::new(name, FieldKind::Choice)
        }
    }

    /// The role the form gives the field: its declared role, or decided when it declares a policy that suggests.
    pub fn declared_role(&self) -> Option<Role> {
        self.role.or(match self.policy {
            Some(Policy::Offer | Policy::Confirm) => Some(Role::Decided),
            _ => None,
        })
    }

    /// Whether the field takes only its own choices, of which there are at least two.
    pub fn is_closed_choice(&self) -> bool {
        self.kind == FieldKind::Choice && !self.open && self.choices.len() >= 2
    }
}

/// Which fields are decided when the form does not say.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
pub enum Inference {
    /// In a form that declares no role at all, every closed choice field — two or more choices, nothing outside
    /// them, not worked out — is decided and the rest observed. A single checkbox or switch is never decided this
    /// way: such a field is often a consent or an attestation, which the records would back with full confidence
    /// and which must still never be suggested.
    #[default]
    ClosedChoices,
    /// Only the fields the form declares decided are decided — for a host whose forms hold closed fields that
    /// must not be suggested however consistent the records are, such as an assessment of a person.
    DeclaredOnly,
}

/// A form as the host hands it over.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(deny_unknown_fields))]
pub struct Form {
    pub fields: Vec<Field>,
}

/// A field with every setting worked out.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ResolvedField {
    pub field: Field,
    pub role: Role,
    /// Whether the role came from the form rather than from [`Inference`].
    pub declared: bool,
    /// [`Policy::Off`] for an observed field.
    pub policy: Policy,
    pub evidence: bool,
}

/// What is wrong with a form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SchemaError {
    /// Two fields share a name.
    DuplicateField(String),
    /// A field names a parent the form does not have.
    UnknownParent { field: String, parent: String },
    /// A field declared observed also declares a policy that suggests.
    PolicyOnObserved(String),
    /// A worked-out field is declared decided.
    DecidedComputed(String),
    /// A value not to miss is not one of the field's choices.
    MustCatchUnlisted { field: String, value: String },
    /// A class of no characters.
    EmptyCoarse(String),
}

impl fmt::Display for SchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SchemaError::DuplicateField(name) => write!(f, "two fields are named `{name}`"),
            SchemaError::UnknownParent { field, parent } => {
                write!(
                    f,
                    "field `{field}` depends on `{parent}`, which the form does not have"
                )
            }
            SchemaError::PolicyOnObserved(name) => {
                write!(
                    f,
                    "field `{name}` is declared observed but its policy suggests — only decided fields are suggested"
                )
            }
            SchemaError::DecidedComputed(name) => {
                write!(
                    f,
                    "field `{name}` is worked out from other fields and cannot be decided"
                )
            }
            SchemaError::MustCatchUnlisted { field, value } => {
                write!(
                    f,
                    "field `{field}` must not miss `{value}`, which is not one of its choices"
                )
            }
            SchemaError::EmptyCoarse(name) => {
                write!(
                    f,
                    "field `{name}` names a class of no characters — coarse counts from 1"
                )
            }
        }
    }
}

impl std::error::Error for SchemaError {}

impl Form {
    /// Whether any field declares its role. A form that declares one is taken at its word for all of them: the
    /// fields it leaves undeclared are observed, so marking one field never quietly turns others on.
    pub fn declares_roles(&self) -> bool {
        self.fields.iter().any(|f| f.declared_role().is_some())
    }

    /// Every field with its role, policy and evidence settled, in the form's order.
    pub fn resolve(&self, inference: Inference) -> Result<Vec<ResolvedField>, SchemaError> {
        let mut names = BTreeSet::new();
        for field in &self.fields {
            if !names.insert(field.name.as_str()) {
                return Err(SchemaError::DuplicateField(field.name.clone()));
            }
        }
        let infer = inference == Inference::ClosedChoices && !self.declares_roles();
        self.fields
            .iter()
            .map(|field| {
                if let Some(parent) = &field.parent
                    && !names.contains(parent.as_str())
                {
                    return Err(SchemaError::UnknownParent {
                        field: field.name.clone(),
                        parent: parent.clone(),
                    });
                }
                if field.role == Some(Role::Observed)
                    && matches!(field.policy, Some(Policy::Offer | Policy::Confirm))
                {
                    return Err(SchemaError::PolicyOnObserved(field.name.clone()));
                }
                let (role, declared) = match field.declared_role() {
                    Some(role) => (role, true),
                    None if infer && field.is_closed_choice() && !field.computed => {
                        (Role::Decided, false)
                    }
                    None => (Role::Observed, false),
                };
                if field.coarse == Some(0) {
                    return Err(SchemaError::EmptyCoarse(field.name.clone()));
                }
                if !field.choices.is_empty()
                    && let Some(value) =
                        field.must_catch.iter().find(|v| !field.choices.contains(v))
                {
                    return Err(SchemaError::MustCatchUnlisted {
                        field: field.name.clone(),
                        value: value.clone(),
                    });
                }
                if role == Role::Decided && field.computed {
                    return Err(SchemaError::DecidedComputed(field.name.clone()));
                }
                let policy = match role {
                    Role::Observed => Policy::Off,
                    Role::Decided => field.policy.unwrap_or_default(),
                };
                Ok(ResolvedField {
                    field: field.clone(),
                    role,
                    declared,
                    policy,
                    evidence: field.evidence.unwrap_or(true),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roles(form: &Form, inference: Inference) -> Vec<(String, Role, Policy)> {
        form.resolve(inference)
            .unwrap()
            .into_iter()
            .map(|r| (r.field.name, r.role, r.policy))
            .collect()
    }

    fn sample() -> Form {
        let mut consent = Field::new("consent", FieldKind::Flag);
        consent.required = true;
        let mut tags = Field::choice("tags", ["a", "b", "c"]);
        tags.multiple = true;
        let mut other = Field::choice("channel", ["phone", "mail"]);
        other.open = true;
        Form {
            fields: vec![
                Field::new("summary", FieldKind::Text),
                Field::choice("handler", ["kim", "lee"]),
                Field::choice("only", ["one"]),
                tags,
                other,
                consent,
            ],
        }
    }

    #[test]
    fn closed_choices_are_decided_when_the_form_declares_nothing() {
        use Role::*;
        let got = roles(&sample(), Inference::ClosedChoices);
        let decided: Vec<_> = got
            .iter()
            .filter(|(_, r, _)| *r == Decided)
            .map(|(n, _, _)| n.as_str())
            .collect();
        assert_eq!(decided, ["handler", "tags"]);
        assert!(
            got.iter()
                .all(|(_, r, p)| (*r == Decided) == (*p == Policy::Offer))
        );
    }

    #[test]
    fn a_single_checkbox_open_choice_or_one_choice_field_is_never_inferred() {
        let got = roles(&sample(), Inference::ClosedChoices);
        for name in ["consent", "channel", "only", "summary"] {
            assert!(
                got.iter()
                    .any(|(n, r, _)| n == name && *r == Role::Observed),
                "{name}"
            );
        }
    }

    #[test]
    fn a_declared_role_turns_inference_off_for_the_whole_form() {
        let mut form = sample();
        form.fields[0].role = Some(Role::Decided);
        let decided: Vec<_> = roles(&form, Inference::ClosedChoices)
            .into_iter()
            .filter(|(_, r, _)| *r == Role::Decided)
            .map(|(n, _, _)| n)
            .collect();
        assert_eq!(decided, ["summary"]);
    }

    #[test]
    fn declared_only_decides_nothing_undeclared() {
        assert!(
            roles(&sample(), Inference::DeclaredOnly)
                .iter()
                .all(|(_, r, _)| *r == Role::Observed)
        );
    }

    #[test]
    fn a_single_checkbox_can_be_decided_by_declaring_a_policy_for_it() {
        let mut form = sample();
        form.fields[5].policy = Some(Policy::Confirm);
        let consent = form
            .resolve(Inference::ClosedChoices)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            (consent.role, consent.declared, consent.policy),
            (Role::Decided, true, Policy::Confirm)
        );
    }

    #[test]
    fn an_inferred_field_keeps_its_declared_policy() {
        let mut form = sample();
        form.fields[1].policy = Some(Policy::Off);
        let handler = &form.resolve(Inference::ClosedChoices).unwrap()[1];
        assert_eq!(
            (handler.role, handler.declared, handler.policy),
            (Role::Decided, false, Policy::Off)
        );
    }

    #[test]
    fn evidence_is_kept_unless_the_form_says_otherwise() {
        let mut form = sample();
        form.fields[0].evidence = Some(false);
        let resolved = form.resolve(Inference::ClosedChoices).unwrap();
        assert!(!resolved[0].evidence && resolved[1..].iter().all(|r| r.evidence));
    }

    #[test]
    fn a_worked_out_field_is_never_decided() {
        let mut form = Form {
            fields: vec![Field::choice("total", ["1", "2"])],
        };
        form.fields[0].computed = true;
        assert_eq!(roles(&form, Inference::ClosedChoices)[0].1, Role::Observed);
        form.fields[0].role = Some(Role::Decided);
        assert_eq!(
            form.resolve(Inference::ClosedChoices),
            Err(SchemaError::DecidedComputed("total".into()))
        );
    }

    #[test]
    fn mistakes_in_the_form_are_named() {
        let dup = Form {
            fields: vec![
                Field::new("a", FieldKind::Text),
                Field::new("a", FieldKind::Number),
            ],
        };
        assert_eq!(
            dup.resolve(Inference::default()),
            Err(SchemaError::DuplicateField("a".into()))
        );

        let mut orphan = Field::choice("city", ["x", "y"]);
        orphan.parent = Some("country".into());
        let form = Form {
            fields: vec![orphan],
        };
        assert_eq!(
            form.resolve(Inference::default()),
            Err(SchemaError::UnknownParent {
                field: "city".into(),
                parent: "country".into()
            })
        );

        let mut observed = Field::new("note", FieldKind::Text);
        observed.role = Some(Role::Observed);
        observed.policy = Some(Policy::Confirm);
        let form = Form {
            fields: vec![observed],
        };
        assert_eq!(
            form.resolve(Inference::default()),
            Err(SchemaError::PolicyOnObserved("note".into()))
        );
        let mut handler = Field::choice("handler", ["kim", "lee"]);
        handler.must_catch = vec!["park".into()];
        let form = Form {
            fields: vec![handler],
        };
        assert_eq!(
            form.resolve(Inference::default()),
            Err(SchemaError::MustCatchUnlisted {
                field: "handler".into(),
                value: "park".into()
            })
        );

        let mut code = Field::new("code", FieldKind::Text);
        code.coarse = Some(0);
        let form = Form { fields: vec![code] };
        assert_eq!(
            form.resolve(Inference::default()),
            Err(SchemaError::EmptyCoarse("code".into()))
        );
    }

    #[cfg(feature = "serde")]
    #[test]
    fn a_form_reads_from_json() {
        let form: Form = serde_json::from_str(
            r#"{"fields":[
                {"name":"handler","kind":"choice","choices":["kim","lee"],"policy":"confirm"},
                {"name":"customer","kind":"reference","evidence":false},
                {"name":"note","kind":"text","role":"observed"}
            ]}"#,
        )
        .unwrap();
        let resolved = form.resolve(Inference::ClosedChoices).unwrap();
        assert_eq!(
            (resolved[0].role, resolved[0].declared),
            (Role::Decided, true),
            "a suggesting policy declares"
        );
        assert!(!resolved[1].evidence);
        assert!(
            serde_json::from_str::<Form>(r#"{"fields":[{"name":"a","kind":"text","x":1}]}"#)
                .is_err()
        );
        let round = serde_json::to_string(&form).unwrap();
        assert_eq!(serde_json::from_str::<Form>(&round).unwrap(), form);
        assert_eq!(
            serde_json::to_string(&Inference::DeclaredOnly).unwrap(),
            r#""declared-only""#
        );
    }
}
