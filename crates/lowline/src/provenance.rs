use std::collections::BTreeMap;

use crate::proposal::{Layer, Proposal};
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
    /// A person settled a value while the decider's answer was held back, the field having been drawn to be checked
    /// with a known probability ([`Draft::hold`]). Counted as one ÷ that probability values settled with nothing in
    /// view, it keeps a field that is suggested well from running out of values to count its precision on.
    Check,
}

/// The settlement of one decided field.
#[derive(Clone, Debug, PartialEq)]
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
    /// For a check, the probability the field was drawn with; `None` otherwise.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    pub probability: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
struct Track {
    #[cfg_attr(feature = "serde", serde(default))]
    shown: Option<Suggestion>,
    #[cfg_attr(feature = "serde", serde(default))]
    declined: bool,
    /// The probability the field was drawn to be checked with, while its answer is held back.
    #[cfg_attr(feature = "serde", serde(default))]
    held: Option<f64>,
    /// The answer held back for a check, kept so the record can say what the person was not shown.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    withheld: Option<Suggestion>,
    /// The layer that gave the suggestion shown (or held back), when the host reported it.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    layer: Option<Layer>,
    /// The precision promised for the suggestion shown (or held back), when the host reported it.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    promise: Option<f64>,
    /// When the person reached the field, or its suggestion came into view — the first of the two — on the host's
    /// clock, in milliseconds.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    at: Option<u64>,
}

/// The account of one record while it is being written: what it held when opened, and for each field the
/// suggestion last shown and whether it was turned down.
///
/// The host reports what the person sees and does — [`Draft::show`], [`Draft::decline`], [`Draft::hold`] — and hands
/// the saved values to [`Draft::settle`]. Typing needs no report: the saved value says what was typed.
///
/// A host that wants the record to say more reports more, all of it optional: the layer and promise of a suggestion
/// ([`Draft::show_proposed`], [`Draft::hold_proposed`]), when the record was opened and saved and when a field was
/// reached ([`Draft::open_at`], [`Draft::save_at`], [`Draft::reach`] — one steady clock, in milliseconds), the order
/// values arrived in ([`Draft::arrived`]), who settled ([`Draft::settled_by`]) and the batch ([`Draft::in_batch`]).
///
/// With `serde` it reads and writes as `{ "opened": { field: value }, "fields": { field: { "shown": suggestion,
/// "declined": bool, "held": probability } } }`, each part optional — what a form drawn in a browser keeps and sends
/// with the save — plus, when reported, `"opened_at"`, `"saved_at"` (milliseconds), `"arrival"` (field names), `"by"`
/// and `"batch"` beside them, and `"layer"`, `"promise"`, `"at"` and `"withheld"` in a field.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Draft {
    #[cfg_attr(feature = "serde", serde(default))]
    opened: BTreeMap<String, FieldValue>,
    #[cfg_attr(feature = "serde", serde(default))]
    fields: BTreeMap<String, Track>,
    /// When the record was opened and when it was saved, on the host's clock, in milliseconds. Only their
    /// difference, and the field times' difference to the save, are read.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    opened_at: Option<u64>,
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    saved_at: Option<u64>,
    /// The fields in the order their current values arrived, oldest first.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    arrival: Vec<String>,
    /// Who settled the record, as an opaque id the host gives — one person, one id; not a name.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    by: Option<String>,
    /// The batch the record was settled in, when several came at once from one source.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Option::is_none")
    )]
    batch: Option<String>,
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
            ..Self::default()
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
        track.held = None;
        track.withheld = None;
        track.layer = None;
        track.promise = None;
    }

    /// The suggestion of `proposal` came into view, with the layer that gave it and the precision it promised, so
    /// that the record can say both. Returns false, changing nothing, for a proposal with no suggestion.
    pub fn show_proposed(&mut self, proposal: &Proposal) -> bool {
        let Some(suggestion) = proposal.suggestion.clone() else {
            return false;
        };
        self.show(&proposal.field, suggestion);
        let track = self.fields.entry(proposal.field.clone()).or_default();
        track.layer = proposal.layer;
        track.promise = proposal.promise;
        true
    }

    /// The field was drawn to be checked, with `probability` fixed before the draw ([`crate::Recheck`]): its answer is
    /// held back, and the value the person settles is a [`SettlementKind::Check`]. A suggestion shown afterwards ends
    /// the check. A field drawn because its answer looked doubtful is not a check — the draw is the host's roll alone.
    ///
    /// # Panics
    /// When `probability` is not above 0 and at most 1.
    pub fn hold(&mut self, field: &str, probability: f64) {
        assert!(
            probability > 0.0 && probability <= 1.0,
            "a check is drawn with a probability above 0 and at most 1"
        );
        let track = self.fields.entry(field.to_owned()).or_default();
        track.shown = None;
        track.declined = false;
        track.held = Some(probability);
        track.withheld = None;
        track.layer = None;
        track.promise = None;
    }

    /// As [`Draft::hold`] for the field of `proposal`, which also keeps the answer held back with its layer and
    /// promise, so that the record of the check says what the person was not shown. Returns false, changing nothing,
    /// for a proposal with no suggestion.
    ///
    /// # Panics
    /// When `probability` is not above 0 and at most 1.
    pub fn hold_proposed(&mut self, proposal: &Proposal, probability: f64) -> bool {
        let Some(suggestion) = proposal.suggestion.clone() else {
            return false;
        };
        self.hold(&proposal.field, probability);
        let track = self.fields.entry(proposal.field.clone()).or_default();
        track.withheld = Some(suggestion);
        track.layer = proposal.layer;
        track.promise = proposal.promise;
        true
    }

    /// The record was opened at `ms` on the host's clock (any steady clock in milliseconds: only differences are read).
    pub fn open_at(&mut self, ms: u64) {
        self.opened_at = Some(ms);
    }

    /// The record was saved at `ms` on the same clock; report it just before handing the draft to [`Draft::settle`].
    pub fn save_at(&mut self, ms: u64) {
        self.saved_at = Some(ms);
    }

    /// The person reached the field, or its suggestion came into view, at `ms` on the same clock. Only the first
    /// report for a field counts: the time to settle it runs from there.
    pub fn reach(&mut self, field: &str, ms: u64) {
        self.fields
            .entry(field.to_owned())
            .or_default()
            .at
            .get_or_insert(ms);
    }

    /// The field's current value arrived now: it moves to the end of the order values arrived in.
    pub fn arrived(&mut self, field: &str) {
        self.arrival.retain(|f| f != field);
        self.arrival.push(field.to_owned());
    }

    /// The record is settled by the person `id`, an opaque id the host gives — one person, one id; not a name.
    pub fn settled_by(&mut self, id: impl Into<String>) {
        self.by = Some(id.into());
    }

    /// The record is settled in the batch `id`, together with the records that came at once from the same source.
    pub fn in_batch(&mut self, id: impl Into<String>) {
        self.batch = Some(id.into());
    }

    /// The answer in view for the field: the suggestion shown, or the one held back for a check.
    pub fn in_view(&self, field: &str) -> Option<&Suggestion> {
        let track = self.fields.get(field)?;
        track.shown.as_ref().or(track.withheld.as_ref())
    }

    /// The layer reported for the answer in view for the field.
    pub fn layer(&self, field: &str) -> Option<Layer> {
        self.fields.get(field).and_then(|track| track.layer)
    }

    /// The precision reported as promised for the answer in view for the field.
    pub fn promise(&self, field: &str) -> Option<f64> {
        self.fields.get(field).and_then(|track| track.promise)
    }

    /// Milliseconds from when the person reached the field to the save, when both were reported.
    pub fn settle_ms(&self, field: &str) -> Option<u64> {
        let reached = self.fields.get(field)?.at?;
        Some(self.saved_at?.saturating_sub(reached))
    }

    /// Milliseconds the record was open, when both its opening and its save were reported.
    pub fn open_ms(&self) -> Option<u64> {
        Some(self.saved_at?.saturating_sub(self.opened_at?))
    }

    /// The fields in the order their current values arrived, oldest first.
    pub fn arrival(&self) -> &[String] {
        &self.arrival
    }

    /// Who settled the record, when reported.
    pub fn by(&self) -> Option<&str> {
        self.by.as_deref()
    }

    /// The batch the record was settled in, when reported.
    pub fn batch(&self) -> Option<&str> {
        self.batch.as_deref()
    }

    /// The probability the field was drawn to be checked with, while its answer is held back.
    pub fn held(&self, field: &str) -> Option<f64> {
        self.fields.get(field).and_then(|track| track.held)
    }

    /// The fields of `round` whose suggestion is not to be shown for a check: each field held back, and the other open
    /// fields of its group ([`crate::Proposal::together`]) — a person settling a field checked with nothing in view is not
    /// led by the value suggested for a field settled together with it. Only the held field is the check; the others
    /// are settled as values entered with nothing in view. In `round`'s order.
    pub fn hidden(&self, round: &[crate::Proposal]) -> Vec<String> {
        let held: Vec<&crate::Proposal> = round
            .iter()
            .filter(|p| self.held(&p.field).is_some())
            .collect();
        round
            .iter()
            .filter(|p| {
                held.iter().any(|h| {
                    h.field == p.field || (h.together.is_some() && h.together == p.together)
                })
            })
            .map(|p| p.field.clone())
            .collect()
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
    /// | nothing, the answer held back for a check | any value but the one it was opened with | [`Check`](SettlementKind::Check), with the probability |
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
        let held = match by {
            SettledBy::Person => track.and_then(|t| t.held),
            SettledBy::Application => None,
        };
        let suggested = in_view.map(|s| s.value.clone());
        let settlement = |kind, value, values| Settlement {
            field: field.to_owned(),
            kind,
            value,
            values,
            suggested: suggested.clone(),
            probability: None,
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
        if let Some(probability) = held.filter(|_| !restored) {
            return Some(Settlement {
                probability: Some(probability),
                ..settlement(SettlementKind::Check, Some(value.clone()), None)
            });
        }
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
        assert_eq!(kind(&draft, "C-7"), Some(Correct));
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
        // What a browser keeps may leave any part out.
        assert_eq!(serde_json::from_str::<Draft>("{}").unwrap(), Draft::new());
        let mut shown = Draft::new();
        shown.show("f", Suggestion::new("x"));
        assert_eq!(
            serde_json::from_str::<Draft>(r#"{"fields":{"f":{"shown":{"value":"x"}}}}"#).unwrap(),
            shown
        );
    }

    #[test]
    fn a_value_settled_while_the_answer_was_held_back_is_a_check() {
        let mut draft = Draft::new();
        draft.hold("f", 0.2);
        let settled = one(&draft, "x").unwrap();
        assert_eq!((settled.kind, settled.probability), (Check, Some(0.2)));
        assert_eq!(settled.suggested, None);

        // Showing a suggestion afterwards ends the check; the application never checks.
        draft.show("f", Suggestion::new("x"));
        assert_eq!(kind(&draft, "x"), Some(Accept));
        let mut held = Draft::new();
        held.hold("f", 0.2);
        let filled = held.settle(["f"], &saved([("f", "x".into())]), SettledBy::Application);
        assert_eq!(filled[0].kind, Fill);
    }

    #[test]
    fn a_held_field_saved_as_it_was_opened_is_restored() {
        let mut draft = Draft::reopen([("f", FieldValue::from("x"))]);
        draft.hold("f", 0.2);
        assert_eq!(kind(&draft, "x"), Some(Restore));
        assert_eq!(draft.held("f"), Some(0.2));
    }
}
