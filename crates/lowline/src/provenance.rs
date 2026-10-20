use std::collections::BTreeMap;

use crate::value::FieldValue;

/// What made a suggestion.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Origin {
    /// The decider that learns from this form's records.
    #[default]
    Decider,
    /// Something else the host showed in its place — its own model filling the form from a sentence or a photo, a
    /// rule, a default. Keeping or changing such a value says nothing about the decider's answers.
    Other,
}

/// How a saved value is matched against the suggestion.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Fit {
    /// The value is the suggestion.
    #[default]
    Exact,
    /// The suggestion is a class and the value belongs to it when it begins with the suggestion — a code `A-12` for
    /// a suggested class `A-`.
    Prefix,
}

/// A suggestion shown for a field.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Suggestion {
    pub value: String,
    #[cfg_attr(feature = "serde", serde(default))]
    pub origin: Origin,
    #[cfg_attr(feature = "serde", serde(default))]
    pub fit: Fit,
}

impl Suggestion {
    /// A value suggested by the decider.
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            origin: Origin::Decider,
            fit: Fit::Exact,
        }
    }

    /// A class suggested by the decider: a value is taken as this suggestion when it begins with it.
    pub fn class(value: impl Into<String>) -> Self {
        Self {
            fit: Fit::Prefix,
            ..Self::new(value)
        }
    }

    /// A value from something other than the decider — see [`Origin::Other`].
    pub fn other(value: impl Into<String>) -> Self {
        Self {
            origin: Origin::Other,
            ..Self::new(value)
        }
    }

    fn taken_by(&self, value: &str) -> bool {
        match self.fit {
            Fit::Exact => value == self.value,
            Fit::Prefix => value.starts_with(&self.value),
        }
    }
}

/// Who saved the record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum SettledBy {
    /// A person, who saw what the form showed.
    Person,
    /// The application on its own — an import, a file another program wrote. Nobody saw a suggestion.
    Application,
}

/// What became of a decided field when its record was saved. The names are the decider's: a decider learns from
/// each and counts its precision on the ones a person settled without its answer in view.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum SettlementKind {
    /// The suggested value was taken as it was.
    Accept,
    /// A value other than the suggested one was settled while the suggestion was in view.
    Correct,
    /// The suggestion was turned down and the field left empty.
    Reject,
    /// The field held a value when the record was opened and was emptied.
    Revert,
    /// The value the record held when it was opened, saved again unchanged with no suggestion in view.
    Restore,
    /// The values of a field that takes several were settled.
    Set,
    /// A person settled a value with no suggestion in view.
    Enter,
    /// The application settled a value on its own.
    Fill,
    /// A person kept a value suggested by something other than the decider ([`Origin::Other`]).
    AcceptOther,
    /// A person settled another value than one suggested by something other than the decider.
    CorrectOther,
}

/// The settlement of one decided field.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Settlement {
    pub field: String,
    pub kind: SettlementKind,
    /// The settled value of a single-valued field; `None` for a reject, a revert and a set.
    pub value: Option<String>,
    /// The settled values of a field that takes several, once each and in order; `None` otherwise.
    pub values: Option<Vec<String>>,
    /// The suggestion that was in view, when one was.
    pub suggested: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
struct Track {
    shown: Option<Suggestion>,
    declined: bool,
}

/// The account of one record while it is being written: what it held when opened, and for each field the
/// suggestion last shown and whether it was turned down.
///
/// The host reports what the person sees and does — [`Draft::show`], [`Draft::decline`] — and hands the saved
/// values to [`Draft::settle`]. Typing needs no report: the saved value says what was typed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Draft {
    opened: BTreeMap<String, FieldValue>,
    fields: BTreeMap<String, Track>,
}

impl Draft {
    /// A new record, empty.
    pub fn new() -> Self {
        Self::default()
    }

    /// A saved record opened again, holding these values.
    pub fn reopen<K: Into<String>>(values: impl IntoIterator<Item = (K, FieldValue)>) -> Self {
        Self {
            opened: values
                .into_iter()
                .map(|(field, value)| (field.into(), value))
                .filter(|(_, value)| !value.is_empty())
                .collect(),
            fields: BTreeMap::new(),
        }
    }

    /// A suggestion came into view for the field. It replaces one shown before; a suggestion turned down earlier
    /// stays turned down only if this is the same one.
    pub fn show(&mut self, field: &str, suggestion: Suggestion) {
        let track = self.fields.entry(field.to_owned()).or_default();
        if track.shown.as_ref() != Some(&suggestion) {
            track.declined = false;
        }
        track.shown = Some(suggestion);
    }

    /// The person turned down the suggestion in view for the field. Returns false, changing nothing, when no
    /// suggestion has been shown for it.
    pub fn decline(&mut self, field: &str) -> bool {
        match self.fields.get_mut(field) {
            Some(track) if track.shown.is_some() => {
                track.declined = true;
                true
            }
            _ => false,
        }
    }

    /// The suggestion last shown for the field, if any.
    pub fn shown(&self, field: &str) -> Option<&Suggestion> {
        self.fields
            .get(field)
            .and_then(|track| track.shown.as_ref())
    }

    /// Whether the suggestion in view for the field was turned down.
    pub fn declined(&self, field: &str) -> bool {
        self.fields.get(field).is_some_and(|track| track.declined)
    }

    /// The settlements a save confirms, one for each decided field that was settled, in the order given. A field
    /// left empty that held nothing when opened and whose suggestion was not turned down says nothing.
    ///
    /// For a field that takes one value, when a person saves:
    ///
    /// | in view | saved value | settlement |
    /// |---|---|---|
    /// | a suggestion | taken by it | [`Accept`](SettlementKind::Accept) ([`AcceptOther`](SettlementKind::AcceptOther) for [`Origin::Other`]) |
    /// | a suggestion | another value | [`Correct`](SettlementKind::Correct) ([`CorrectOther`](SettlementKind::CorrectOther)) |
    /// | nothing | the value it was opened with | [`Restore`](SettlementKind::Restore) |
    /// | nothing | any other value | [`Enter`](SettlementKind::Enter) |
    /// | any | empty, having held a value | [`Revert`](SettlementKind::Revert) |
    /// | a suggestion turned down | empty | [`Reject`](SettlementKind::Reject) |
    ///
    /// A field that takes several is [`Set`](SettlementKind::Set), or [`Restore`](SettlementKind::Restore) when
    /// unchanged with nothing in view. When the application saves, a value is [`Fill`](SettlementKind::Fill) (a set
    /// is [`Set`](SettlementKind::Set)) unless it is the one the record was opened with.
    pub fn settle<'a>(
        &self,
        decided: impl IntoIterator<Item = &'a str>,
        saved: &BTreeMap<String, FieldValue>,
        by: SettledBy,
    ) -> Vec<Settlement> {
        decided
            .into_iter()
            .filter_map(|field| {
                self.settle_field(field, saved.get(field).filter(|v| !v.is_empty()), by)
            })
            .collect()
    }

    fn settle_field(
        &self,
        field: &str,
        saved: Option<&FieldValue>,
        by: SettledBy,
    ) -> Option<Settlement> {
        let opened = self.opened.get(field);
        let track = self.fields.get(field);
        let in_view = match by {
            SettledBy::Person => track.and_then(|t| t.shown.as_ref()),
            SettledBy::Application => None,
        };
        let declined = by == SettledBy::Person && track.is_some_and(|t| t.declined);
        let suggested = in_view.map(|s| s.value.clone());
        let settlement = |kind, value, values| Settlement {
            field: field.to_owned(),
            kind,
            value,
            values,
            suggested: suggested.clone(),
        };

        let Some(saved) = saved else {
            return if opened.is_some() {
                Some(settlement(SettlementKind::Revert, None, None))
            } else if declined {
                Some(settlement(SettlementKind::Reject, None, None))
            } else {
                None
            };
        };

        let restored = in_view.is_none() && opened.is_some_and(|o| o.same_as(saved));
        let value = match saved {
            FieldValue::Many(_) => {
                let kind = if restored {
                    SettlementKind::Restore
                } else {
                    SettlementKind::Set
                };
                return Some(settlement(kind, None, saved.set()));
            }
            FieldValue::One(value) => value,
        };
        let kind = match (by, in_view) {
            _ if restored => SettlementKind::Restore,
            (SettledBy::Application, _) => SettlementKind::Fill,
            (SettledBy::Person, None) => SettlementKind::Enter,
            (SettledBy::Person, Some(s)) => match (s.origin, s.taken_by(value)) {
                (Origin::Decider, true) => SettlementKind::Accept,
                (Origin::Decider, false) => SettlementKind::Correct,
                (Origin::Other, true) => SettlementKind::AcceptOther,
                (Origin::Other, false) => SettlementKind::CorrectOther,
            },
        };
        Some(settlement(kind, Some(value.clone()), None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use SettlementKind::*;

    fn saved<const N: usize>(pairs: [(&str, FieldValue); N]) -> BTreeMap<String, FieldValue> {
        pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
    }

    fn one(draft: &Draft, value: impl Into<FieldValue>) -> Option<Settlement> {
        draft
            .settle(["f"], &saved([("f", value.into())]), SettledBy::Person)
            .pop()
    }

    fn kind(draft: &Draft, value: impl Into<FieldValue>) -> Option<SettlementKind> {
        one(draft, value).map(|s| s.kind)
    }

    #[test]
    fn a_value_typed_with_nothing_in_view_is_entered() {
        let draft = Draft::new();
        assert_eq!(kind(&draft, "x"), Some(Enter));
    }

    #[test]
    fn the_suggested_value_saved_is_accepted() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        let s = one(&draft, "x").unwrap();
        assert_eq!(
            (s.kind, s.value.as_deref(), s.suggested.as_deref()),
            (Accept, Some("x"), Some("x"))
        );
    }

    #[test]
    fn another_value_saved_while_a_suggestion_was_in_view_is_a_correction() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        assert_eq!(kind(&draft, "y"), Some(Correct));
    }

    #[test]
    fn a_suggestion_turned_down_and_a_value_typed_is_a_correction() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        assert!(draft.decline("f"));
        assert_eq!(kind(&draft, "y"), Some(Correct));
    }

    #[test]
    fn a_suggestion_turned_down_and_the_field_left_empty_is_a_rejection() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        draft.decline("f");
        let s = one(&draft, "").unwrap();
        assert_eq!(
            (s.kind, s.value, s.suggested.as_deref()),
            (Reject, None, Some("x"))
        );
    }

    #[test]
    fn a_suggestion_ignored_on_a_field_left_empty_says_nothing() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        assert_eq!(kind(&draft, ""), None);
        assert_eq!(
            Draft::new().settle(["f"], &BTreeMap::new(), SettledBy::Person),
            vec![]
        );
    }

    #[test]
    fn turning_down_with_nothing_in_view_changes_nothing() {
        let mut draft = Draft::new();
        assert!(!draft.decline("f"));
        assert_eq!(kind(&draft, ""), None);
    }

    #[test]
    fn a_new_suggestion_clears_an_earlier_turn_down_but_the_same_one_keeps_it() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        draft.decline("f");
        draft.show("f", Suggestion::new("x"));
        assert!(draft.declined("f"));
        draft.show("f", Suggestion::new("y"));
        assert!(!draft.declined("f"));
        assert_eq!(kind(&draft, ""), None);
    }

    #[test]
    fn the_last_suggestion_shown_is_the_one_judged() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::new("x"));
        draft.show("f", Suggestion::new("y"));
        assert_eq!(kind(&draft, "y"), Some(Accept));
        assert_eq!(kind(&draft, "x"), Some(Correct));
    }

    #[test]
    fn a_class_is_taken_by_any_value_that_begins_with_it() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::class("A-"));
        assert_eq!(kind(&draft, "A-12"), Some(Accept));
        assert_eq!(kind(&draft, "B-3"), Some(Correct));
    }

    #[test]
    fn a_value_from_something_else_kept_or_changed_is_told_apart_from_the_deciders() {
        let mut draft = Draft::new();
        draft.show("f", Suggestion::other("x"));
        assert_eq!(kind(&draft, "x"), Some(AcceptOther));
        assert_eq!(kind(&draft, "y"), Some(CorrectOther));
    }

    #[test]
    fn a_reopened_record_saved_unchanged_restores_its_values() {
        let draft = Draft::reopen([("f", FieldValue::from("x"))]);
        let s = one(&draft, "x").unwrap();
        assert_eq!(
            (s.kind, s.value.as_deref(), s.suggested),
            (Restore, Some("x"), None)
        );
    }

    #[test]
    fn a_reopened_value_changed_with_nothing_in_view_is_entered() {
        let draft = Draft::reopen([("f", FieldValue::from("x"))]);
        assert_eq!(kind(&draft, "y"), Some(Enter));
    }

    #[test]
    fn a_reopened_value_kept_against_a_suggestion_is_a_correction() {
        let mut draft = Draft::reopen([("f", FieldValue::from("x"))]);
        draft.show("f", Suggestion::new("y"));
        assert_eq!(kind(&draft, "x"), Some(Correct));
    }

    #[test]
    fn a_reopened_value_emptied_is_reverted() {
        let mut draft = Draft::reopen([("f", FieldValue::from("x"))]);
        assert_eq!(kind(&draft, ""), Some(Revert));
        draft.show("f", Suggestion::new("y"));
        draft.decline("f");
        assert_eq!(kind(&draft, ""), Some(Revert));
    }

    #[test]
    fn an_empty_value_in_the_opened_record_is_no_value() {
        let draft = Draft::reopen([("f", FieldValue::from(""))]);
        assert_eq!(kind(&draft, ""), None);
        assert_eq!(kind(&draft, "x"), Some(Enter));
    }

    #[test]
    fn a_set_is_set_or_restored() {
        let mut draft = Draft::new();
        let s = one(&draft, ["b", "a", "b"].into_iter().collect::<FieldValue>()).unwrap();
        assert_eq!(
            (s.kind, s.values),
            (Set, Some(vec!["a".into(), "b".into()]))
        );

        draft = Draft::reopen([("f", ["a", "b"].into_iter().collect())]);
        assert_eq!(
            kind(&draft, ["b", "a"].into_iter().collect::<FieldValue>()),
            Some(Restore)
        );
        assert_eq!(
            kind(&draft, ["a"].into_iter().collect::<FieldValue>()),
            Some(Set)
        );
        draft.show("f", Suggestion::new("c"));
        assert_eq!(
            kind(&draft, ["a", "b"].into_iter().collect::<FieldValue>()),
            Some(Set)
        );
    }

    #[test]
    fn the_application_fills_and_never_had_anything_in_view() {
        let mut draft = Draft::reopen([("g", FieldValue::from("same"))]);
        draft.show("f", Suggestion::new("x"));
        draft.decline("h");
        let values = saved([
            ("f", "x".into()),
            ("g", "same".into()),
            ("s", ["a"].into_iter().collect()),
            ("h", "".into()),
        ]);
        let kinds: Vec<_> = draft
            .settle(["f", "g", "s", "h"], &values, SettledBy::Application)
            .into_iter()
            .map(|s| (s.field, s.kind, s.suggested))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("f".into(), Fill, None),
                ("g".into(), Restore, None),
                ("s".into(), Set, None),
            ]
        );
    }

    #[test]
    fn only_decided_fields_are_settled_in_the_order_given() {
        let draft = Draft::new();
        let values = saved([("a", "1".into()), ("b", "2".into()), ("c", "3".into())]);
        let fields: Vec<_> = draft
            .settle(["c", "a"], &values, SettledBy::Person)
            .into_iter()
            .map(|s| s.field)
            .collect();
        assert_eq!(fields, ["c", "a"]);
    }

    #[cfg(feature = "serde")]
    #[test]
    fn a_draft_survives_being_written_and_read_back() {
        let mut draft = Draft::reopen([("g", FieldValue::from("x"))]);
        draft.show("f", Suggestion::class("A-"));
        draft.decline("f");
        let json = serde_json::to_string(&draft).unwrap();
        assert_eq!(serde_json::from_str::<Draft>(&json).unwrap(), draft);
        let suggestion: Suggestion = serde_json::from_str(r#"{"value":"x"}"#).unwrap();
        assert_eq!(suggestion, Suggestion::new("x"));
        assert_eq!(
            serde_json::to_string(&SettledBy::Person).unwrap(),
            r#""person""#
        );
    }
}
