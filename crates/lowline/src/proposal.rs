//! What a host shows for a decided field: one suggestion and what it rests on, or why there is none. The same shape
//! whichever decider answered and wherever the form is drawn, so a host shows, and a person reads, every field the same
//! way.

use crate::policy::Policy;
use crate::provenance::Suggestion;

/// Which part of the records a suggestion came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
pub enum Layer {
    /// Values settled together with this record's other values — "records with this customer were handled by Kim".
    Key,
    /// The records most like this one.
    Similar,
    /// A judgement the host made outside the records, such as its model's, that the decider took in.
    Judgement,
}

/// What a suggestion rests on, for the host to show beside it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "serde",
    serde(
        tag = "kind",
        rename_all = "kebab-case",
        rename_all_fields = "camelCase"
    )
)]
pub enum Basis {
    /// Another field's value under which the suggested value was settled before.
    Value { field: String, value: String },
    /// A settled record the suggestion came from, and how alike the two are, from 0 to 1.
    Record { id: String, similarity: f64 },
}

/// Why a decided field is shown no suggestion.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
pub enum Abstain {
    /// The form says the field is never suggested for ([`Policy::Off`]).
    Off,
    /// The records hold nothing that bears on the field yet.
    NoEvidence,
    /// The records lean towards a value, but not as far as the field's threshold trusts.
    Unsure,
    /// The records' value is not among the choices the host allows for this person now. Never moved to a nearby
    /// choice: a value a person may not pick is not suggested.
    NotAllowed,
    /// Nothing in the records bears on the field, and a judgement from outside them — the host's model — could; the
    /// host may ask it ([`Proposal::asks`]).
    NeedsJudgement,
}

/// What a host shows for one decided field.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Proposal {
    pub field: String,
    /// The suggestion to show — hand it to [`crate::Draft::show`] when it is shown. A class ([`crate::Fit::Prefix`])
    /// when only the value's broader class could be suggested.
    pub suggestion: Option<Suggestion>,
    /// Whether the host may put the suggestion in as the field's starting value without a person taking it: only a
    /// value, never a class, and only for a field whose policy is [`Policy::Offer`].
    pub prefill: bool,
    /// Where the suggestion came from.
    pub layer: Option<Layer>,
    /// What it rests on, strongest first; empty when the decider gives none.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub basis: Vec<Basis>,
    /// Why there is no suggestion, when there is none.
    pub abstain: Option<Abstain>,
    /// For [`Abstain::NeedsJudgement`]: the fields and values a judgement from outside the records would read, in the
    /// order they arrived.
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub asks: Vec<(String, String)>,
}

impl Proposal {
    /// A field shown nothing, and why.
    pub fn abstain(field: impl Into<String>, why: Abstain) -> Self {
        Self {
            field: field.into(),
            suggestion: None,
            prefill: false,
            layer: None,
            basis: Vec::new(),
            abstain: Some(why),
            asks: Vec::new(),
        }
    }

    /// A field shown `suggestion`, from `layer` when known, under `policy`.
    pub fn suggest(
        field: impl Into<String>,
        suggestion: Suggestion,
        layer: Option<Layer>,
        basis: Vec<Basis>,
        policy: Policy,
    ) -> Self {
        let prefill = policy.may_prefill() && suggestion.fit == crate::provenance::Fit::Exact;
        Self {
            field: field.into(),
            suggestion: Some(suggestion),
            prefill,
            layer,
            basis,
            abstain: None,
            asks: Vec::new(),
        }
    }
}

#[cfg(all(test, feature = "serde"))]
mod tests {
    use super::*;

    /// The shape a host reads, in any language: field names, kinds and abstain reasons as written here.
    #[test]
    fn reads_and_writes_as_the_protocol_says() {
        let shown = Proposal::suggest(
            "owner",
            Suggestion::new("kim"),
            Some(Layer::Key),
            vec![
                Basis::Value {
                    field: "customer".into(),
                    value: "Acme".into(),
                },
                Basis::Record {
                    id: "r-7".into(),
                    similarity: 0.5,
                },
            ],
            Policy::Offer,
        );
        let json = serde_json::to_value(&shown).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "field": "owner",
                "suggestion": { "value": "kim", "origin": "decider", "fit": "exact" },
                "prefill": true,
                "layer": "key",
                "basis": [
                    { "kind": "value", "field": "customer", "value": "Acme" },
                    { "kind": "record", "id": "r-7", "similarity": 0.5 }
                ],
                "abstain": null
            })
        );
        assert_eq!(serde_json::from_value::<Proposal>(json).unwrap(), shown);

        let asking = Proposal {
            asks: vec![("customer".into(), "Acme".into())],
            ..Proposal::abstain("owner", Abstain::NeedsJudgement)
        };
        let json = serde_json::to_value(&asking).unwrap();
        assert_eq!(json["abstain"], "needs-judgement");
        assert_eq!(json["asks"], serde_json::json!([["customer", "Acme"]]));
        assert_eq!(
            serde_json::to_value(Abstain::NotAllowed).unwrap(),
            "not-allowed"
        );
    }
}
