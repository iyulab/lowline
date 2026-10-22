//! Filling a form from what a person wrote or showed — a sentence, a photo — through the host's model.
//!
//! The engine calls no model. It tells the host what to ask for ([`describe`]): the fields still empty, what kind of
//! value each takes and, for a closed choice, the choices this person may pick. The host asks its model, and hands the
//! model's values back to [`fill`], which checks each against its field and turns it into a [`Proposal`] — a value
//! from elsewhere ([`Origin::Other`](crate::Origin::Other)), shown for the person to take and never put in on its own,
//! so that keeping or changing it says nothing about the decider. A value the field cannot hold is not suggested,
//! nor moved to a nearby choice: a model that names a choice that does not exist, or one this person may not pick,
//! is shown nothing for that field, with why.

use std::collections::BTreeMap;

use crate::policy::Policy;
use crate::proposal::{Abstain, Proposal};
use crate::provenance::Suggestion;
use crate::schema::{FieldKind, ResolvedField};
use crate::value::FieldValue;

/// One field as the host's model is told about it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct FillField {
    pub name: String,
    pub kind: FieldKind,
    /// For a choice field, the values it may take: its choices, narrowed to those this person may pick. Empty for any
    /// other field, and for a choice field that also takes values outside its choices.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub choices: Vec<String>,
}

/// The fields a model may fill for a record holding `values`: those still empty that take one value and are written
/// rather than worked out, leaving out a field the form never suggests for, and a closed choice field with no choice
/// this person may pick (`allowed`, by field — a field it leaves out may take any of its choices). Several values in
/// one field are not filled.
pub fn describe(
    fields: &[ResolvedField],
    values: &BTreeMap<String, FieldValue>,
    allowed: &BTreeMap<String, Vec<String>>,
) -> Vec<FillField> {
    fields
        .iter()
        .filter(|f| {
            !f.field.computed
                && !f.field.multiple
                && f.field.policy != Some(Policy::Off)
                && values.get(&f.field.name).is_none_or(FieldValue::is_empty)
        })
        .filter_map(|f| {
            let field = &f.field;
            let choices = match (field.kind, field.open) {
                (FieldKind::Choice, false) => {
                    let may: Vec<String> = match allowed.get(&field.name) {
                        Some(allowed) => field
                            .choices
                            .iter()
                            .filter(|c| allowed.contains(c))
                            .cloned()
                            .collect(),
                        None => field.choices.clone(),
                    };
                    if may.is_empty() {
                        return None;
                    }
                    may
                }
                _ => Vec::new(),
            };
            Some(FillField {
                name: field.name.clone(),
                kind: field.kind,
                choices,
            })
        })
        .collect()
}

/// What to show for each field the model answered, in the form's order: its value as a suggestion from elsewhere, or
/// why there is none. Only the fields [`describe`] gives are filled; a value for any other field, and an empty one,
/// is left out. The proposals never put a value in on their own.
pub fn fill(
    fields: &[ResolvedField],
    values: &BTreeMap<String, FieldValue>,
    allowed: &BTreeMap<String, Vec<String>>,
    answered: &BTreeMap<String, FieldValue>,
) -> Vec<Proposal> {
    let open = describe(fields, values, allowed);
    open.iter()
        .filter_map(|wanted| {
            let answer = answered.get(&wanted.name).filter(|v| !v.is_empty())?;
            let resolved = fields.iter().find(|f| f.field.name == wanted.name)?;
            Some(match check(resolved, wanted, answer) {
                Ok(value) => Proposal::suggest(
                    &wanted.name,
                    Suggestion::other(value),
                    None,
                    Vec::new(),
                    Policy::Confirm,
                ),
                Err(why) => Proposal::abstain(&wanted.name, why),
            })
        })
        .collect()
}

/// The model's value for a field, as the field holds it — trimmed — or why the field cannot hold it.
fn check(
    resolved: &ResolvedField,
    wanted: &FillField,
    answer: &FieldValue,
) -> Result<String, Abstain> {
    let FieldValue::One(raw) = answer else {
        return Err(Abstain::Malformed);
    };
    let value = raw.trim();
    let field = &resolved.field;
    let fits = match field.kind {
        FieldKind::Text | FieldKind::Reference => true,
        FieldKind::Number => value.parse::<f64>().is_ok_and(f64::is_finite),
        FieldKind::Date => is_date_or_time(value),
        FieldKind::Flag => value == "true" || value == "false",
        FieldKind::Choice if field.open => true,
        FieldKind::Choice => {
            if !field.choices.iter().any(|c| c == value) {
                return Err(Abstain::NotAChoice);
            }
            if !wanted.choices.iter().any(|c| c == value) {
                return Err(Abstain::NotAllowed);
            }
            true
        }
    };
    if fits {
        Ok(value.to_owned())
    } else {
        Err(Abstain::Malformed)
    }
}

/// A date, a time, or both, as a form writes them: `2026-10-23`, `2026-10`, `2026-W43`, `14:05`, `14:05:30`,
/// `2026-10-23T14:05`.
fn is_date_or_time(value: &str) -> bool {
    fn digits(s: &str, n: usize) -> bool {
        s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
    }
    fn time(s: &str) -> bool {
        let parts: Vec<&str> = s.split(':').collect();
        matches!(parts.as_slice(), [h, m] | [h, m, _] if digits(h, 2) && digits(m, 2))
            && parts.get(2).is_none_or(|s| digits(s, 2))
    }
    fn date(s: &str) -> bool {
        match s.split('-').collect::<Vec<_>>().as_slice() {
            [y, m, d] => digits(y, 4) && digits(m, 2) && digits(d, 2),
            [y, w] if w.starts_with('W') => digits(y, 4) && digits(&w[1..], 2),
            [y, m] => digits(y, 4) && digits(m, 2),
            _ => false,
        }
    }
    match value.split_once('T') {
        Some((d, t)) => date(d) && time(t),
        None => date(value) || time(value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Field, Form, Inference, Origin};

    fn form() -> Vec<ResolvedField> {
        let mut tags = Field::choice("tags", ["a", "b"]);
        tags.multiple = true;
        let mut total = Field::new("total", FieldKind::Number);
        total.computed = true;
        let mut quiet = Field::choice("quiet", ["x", "y"]);
        quiet.policy = Some(Policy::Off);
        let mut kind = Field::choice("kind", ["repair", "replace"]);
        kind.open = true;
        Form {
            fields: vec![
                Field::new("customer", FieldKind::Text),
                Field::choice("owner", ["kim", "lee"]),
                Field::new("amount", FieldKind::Number),
                Field::new("due", FieldKind::Date),
                Field::new("urgent", FieldKind::Flag),
                kind,
                tags,
                total,
                quiet,
            ],
        }
        .resolve(Inference::ClosedChoices)
        .unwrap()
    }

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, FieldValue> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), FieldValue::from(*v)))
            .collect()
    }

    #[test]
    fn a_model_is_told_about_the_empty_fields_it_may_fill() {
        let none = BTreeMap::new();
        let told = describe(&form(), &values(&[("customer", "Acme")]), &none);
        let names: Vec<_> = told.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["owner", "amount", "due", "urgent", "kind"]);
        assert_eq!(told[0].choices, ["kim", "lee"]);
        assert!(told[4].choices.is_empty(), "an open choice takes any value");

        let kim_only = BTreeMap::from([("owner".to_owned(), vec!["kim".to_owned()])]);
        assert_eq!(
            describe(&form(), &BTreeMap::new(), &kim_only)[1].choices,
            ["kim"]
        );
        let nobody = BTreeMap::from([("owner".to_owned(), Vec::new())]);
        assert!(
            describe(&form(), &BTreeMap::new(), &nobody)
                .iter()
                .all(|f| f.name != "owner")
        );
    }

    #[test]
    fn what_the_model_says_is_shown_from_elsewhere_and_never_put_in() {
        let answered = values(&[
            ("customer", " Acme "),
            ("owner", "lee"),
            ("amount", "12.5"),
            ("due", "2026-10-23"),
            ("urgent", "true"),
            ("kind", "inspect"),
        ]);
        let shown = fill(&form(), &BTreeMap::new(), &BTreeMap::new(), &answered);
        assert_eq!(shown.len(), 6);
        for proposal in &shown {
            let suggestion = proposal.suggestion.as_ref().unwrap();
            assert_eq!(suggestion.origin, Origin::Other);
            assert!(!proposal.prefill, "{}", proposal.field);
        }
        assert_eq!(shown[0].suggestion.as_ref().unwrap().value, "Acme");
        assert_eq!(shown[5].suggestion.as_ref().unwrap().value, "inspect");
    }

    #[test]
    fn a_value_the_field_cannot_hold_is_not_suggested_nor_moved() {
        let kim_only = BTreeMap::from([("owner".to_owned(), vec!["kim".to_owned()])]);
        let why = |field: &str, value: &str, allowed: &BTreeMap<String, Vec<String>>| {
            let shown = fill(
                &form(),
                &BTreeMap::new(),
                allowed,
                &values(&[(field, value)]),
            );
            (shown[0].suggestion.clone(), shown[0].abstain)
        };
        let none = BTreeMap::new();
        assert_eq!(
            why("owner", "Kim", &none),
            (None, Some(Abstain::NotAChoice))
        );
        assert_eq!(
            why("owner", "lee", &kim_only),
            (None, Some(Abstain::NotAllowed))
        );
        assert_eq!(
            why("amount", "twelve", &none),
            (None, Some(Abstain::Malformed))
        );
        assert_eq!(
            why("due", "next tuesday", &none),
            (None, Some(Abstain::Malformed))
        );
        assert_eq!(
            why("urgent", "yes", &none),
            (None, Some(Abstain::Malformed))
        );
    }

    #[test]
    fn fields_the_model_was_not_asked_about_are_left_out() {
        let answered = values(&[
            ("customer", "Beta"),
            ("total", "3"),
            ("quiet", "x"),
            ("nowhere", "z"),
            ("owner", ""),
        ]);
        let holding = values(&[("customer", "Acme")]);
        assert!(fill(&form(), &holding, &BTreeMap::new(), &answered).is_empty());
        let several = BTreeMap::from([(
            "amount".to_owned(),
            FieldValue::Many(vec!["1".into(), "2".into()]),
        )]);
        assert_eq!(
            fill(&form(), &BTreeMap::new(), &BTreeMap::new(), &several)[0].abstain,
            Some(Abstain::Malformed)
        );
    }

    #[test]
    fn dates_and_times_as_forms_write_them() {
        for good in [
            "2026-10-23",
            "2026-10",
            "2026-W43",
            "14:05",
            "14:05:30",
            "2026-10-23T14:05",
        ] {
            assert!(is_date_or_time(good), "{good}");
        }
        for bad in [
            "",
            "2026/10/23",
            "26-10-23",
            "14h05",
            "2026-10-23T",
            "T14:05",
            "2026-10-23 14:05",
        ] {
            assert!(!is_date_or_time(bad), "{bad}");
        }
    }
}
