//! The engine's form and settlements in the decider's vocabulary — [Gil](https://crates.io/crates/iyulab-gil).
//!
//! A host that answers with Gil hands it the [`gil::schema::Schema`] made from the resolved form ([`schema`]) and, when
//! a record is saved, the settlement of each decided field ([`Settlement::to_gil`]). What Gil answers for a field becomes
//! the [`Proposal`] the host shows ([`proposal`]).

use crate::policy::Policy;
#[cfg(test)]
use crate::proposal::Recheck;
use crate::proposal::{Abstain, Basis, Layer, Proposal};
use crate::provenance::{Settlement, SettlementKind, Suggestion};
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

/// How a decided field's thresholds are chosen ([`tune`]). The default is the desktop app's: a precision of 0.8 —
/// answering pays when a wrong value costs about five entries — over at least ten answers, the similar records layer
/// trusted only where its promise rests on at least thirty answers, every band of answers held to the target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tune {
    pub target_precision: f64,
    pub minimum_answered: usize,
    /// How many independent answers the similar records layer's promise must rest on before it is trusted at all.
    ///
    /// The default of thirty is a gate the desktop app set before turning the layer on, and kept after replaying a
    /// year and more of settled records of several forms through it: over a whole replay the layer's answers kept
    /// close to their promise, while the stretches that promised more than they kept were the ones just past the gate,
    /// on few answers. A lower gate lets the layer answer sooner at that cost; a host with its own replays may move it.
    pub similar_minimum_answered: f64,
    pub rule: gil::replay::ThresholdRule,
}

impl Default for Tune {
    fn default() -> Self {
        Self {
            target_precision: 0.8,
            minimum_answered: 10,
            similar_minimum_answered: 30.0,
            rule: gil::replay::ThresholdRule::EveryBand,
        }
    }
}

/// Chooses the thresholds of `schema`'s decided attributes on the settled `records`, sets them on the schema and
/// answers the [`gil::tuning::Tuning`] that keeps them — what a host stores and puts back with `Tuning::apply`, and
/// chooses again once `Tuning::stale` says so (including when there is no tuning yet). Precision is counted on
/// [`COUNTED`] settlements only. Records are replayed in settlement order, through default memories — a host that
/// answers with differently configured memories chooses with those instead.
///
/// A field that takes one value has its key and similar records thresholds chosen together; one that takes several,
/// its key threshold. Where a replay chooses nothing, the field is not answered until enough records are settled.
/// Key fields, typed thresholds and coarse thresholds are left as the schema holds them.
pub fn tune(
    schema: &mut gil::schema::Schema,
    records: &[gil::schema::Record],
    tune: &Tune,
) -> gil::tuning::Tuning {
    let mut ordered: Vec<gil::schema::Record> = records.to_vec();
    ordered.sort_by_key(|r| r.settled_at);
    let choice = gil::replay::Choice {
        target_precision: tune.target_precision,
        minimum_answered: tune.minimum_answered,
        counting: Some(COUNTED),
    };
    let decided: Vec<(String, bool)> = schema
        .attributes
        .iter()
        .filter(|a| a.role == gil::schema::AttributeRole::Decided)
        .map(|a| (a.name.clone(), a.multiple))
        .collect();

    let mut promises = Vec::new();
    for (name, multiple) in decided {
        if multiple {
            let key = gil::replay::select_key_threshold(
                &mut gil::key_memory::KeyMemory::default(),
                schema,
                &name,
                &ordered,
                choice,
            );
            let attribute = attribute_mut(schema, &name);
            attribute.key_threshold = key.chosen.map(|c| c.threshold);
            continue;
        }
        let layers = gil::replay::select_layers_by_rule(
            &mut gil::key_memory::KeyMemory::default(),
            &mut gil::lexical_memory::LexicalMemory::default(),
            schema,
            &name,
            &ordered,
            choice,
            tune.rule,
        );
        let attribute = attribute_mut(schema, &name);
        attribute.key_threshold = layers.key.chosen.as_ref().map(|c| c.threshold);
        let similar = layers
            .memory
            .chosen
            .as_ref()
            .filter(|c| c.promise_answered >= tune.similar_minimum_answered);
        attribute.memory_threshold = similar.map(|c| c.threshold);
        attribute.memory_floor = similar.and_then(|c| c.similarity_floor);
        promises.push((name, layers));
    }

    let mut tuning = gil::tuning::Tuning::capture(schema, ordered.len(), tune.target_precision);
    for (name, layers) in &promises {
        tuning.promise(name, layers);
    }
    // A similar records threshold left untrusted promises nothing.
    for tuned in &mut tuning.attributes {
        if tuned.memory_threshold.is_none() {
            tuned.memory_promise = None;
        }
    }
    tuning
}

fn attribute_mut<'a>(
    schema: &'a mut gil::schema::Schema,
    name: &str,
) -> &'a mut gil::schema::Attribute {
    schema
        .attributes
        .iter_mut()
        .find(|a| a.name == name)
        .expect("an attribute of the schema")
}

/// A saved record as Gil keeps it: its values by field, a decided field that takes several as a set, an observed one
/// that takes several as one value — its values sorted and joined with `", "`, the attribute [`schema`] made of it —
/// and how each decided field was settled. `settled_at` is in 100-nanosecond ticks since the Unix epoch, UTC. Empty
/// values are left out.
pub fn record(
    id: &str,
    fields: &[ResolvedField],
    saved: &std::collections::BTreeMap<String, crate::FieldValue>,
    settlements: &[Settlement],
    settled_at: i64,
) -> gil::schema::Record {
    let mut record = gil::schema::Record {
        id: id.to_owned(),
        settled_at,
        ..Default::default()
    };
    for resolved in fields {
        let name = &resolved.field.name;
        let Some(value) = saved.get(name).filter(|v| !v.is_empty()) else {
            continue;
        };
        match value {
            crate::FieldValue::One(one) => {
                record.values.insert(name.clone(), one.clone());
            }
            crate::FieldValue::Many(_) if resolved.role == Role::Decided => {
                record
                    .sets
                    .insert(name.clone(), value.set().unwrap_or_default());
            }
            crate::FieldValue::Many(_) => {
                record
                    .values
                    .insert(name.clone(), value.set().unwrap_or_default().join(", "));
            }
        }
    }
    for settlement in settlements {
        record
            .settlements
            .insert(settlement.field.clone(), settlement.kind.into());
        if let Some(probability) = settlement.probability {
            record
                .probabilities
                .insert(settlement.field.clone(), probability);
        }
    }
    record
}

/// What to show for a decided field, from Gil's answer for its attribute.
///
/// The first candidate, when Gil trusts it; else the class Gil trusts, as a class suggestion; else nothing, and why —
/// with what a judgement from outside the records would read when Gil asks for one. `allowed`, when the host gives it,
/// is the choices this person may pick now (the host's permissions and active filters): a value outside them is not
/// suggested, nor moved to a nearby choice, and a class is suggested only when one of them lies in it.
pub fn proposal(
    field: &ResolvedField,
    answer: &gil::decider::Answer,
    allowed: Option<&[String]>,
) -> Proposal {
    let name = field.field.name.as_str();
    if field.policy == Policy::Off || answer.policy == gil::schema::AttributePolicy::Off {
        return Proposal::abstain(name, Abstain::Off);
    }

    let may_pick = |value: &str| allowed.is_none_or(|a| a.iter().any(|c| c == value));
    if let Some(first) = answer.candidates.first().filter(|c| c.trusted) {
        if !may_pick(&first.value) {
            return Proposal::abstain(name, Abstain::NotAllowed);
        }
        let suggestion = Suggestion::new(first.value.clone());
        return Proposal::suggest(
            name,
            suggestion,
            layer(first.source),
            basis(first),
            field.policy,
        );
    }
    if let Some(class) = answer.coarse.as_ref().filter(|c| c.trusted) {
        if allowed.is_some_and(|a| !a.iter().any(|c| c.starts_with(&class.value))) {
            return Proposal::abstain(name, Abstain::NotAllowed);
        }
        let suggestion = Suggestion::class(class.value.clone());
        return Proposal::suggest(
            name,
            suggestion,
            layer(class.source),
            basis(class),
            field.policy,
        );
    }
    if let Some(asks) = &answer.needs_external {
        return Proposal {
            asks: asks.clone(),
            ..Proposal::abstain(name, Abstain::NeedsJudgement)
        };
    }
    let why = if answer.candidates.is_empty() {
        Abstain::NoEvidence
    } else {
        Abstain::Unsure
    };
    Proposal::abstain(name, why)
}

fn layer(source: gil::decider::Source) -> Option<Layer> {
    match source {
        gil::decider::Source::SettledFieldMemory => Some(Layer::Key),
        gil::decider::Source::SimilarDocument => Some(Layer::Similar),
        gil::decider::Source::External => Some(Layer::Judgement),
        gil::decider::Source::None => None,
    }
}

fn basis(candidate: &gil::decider::Candidate) -> Vec<Basis> {
    candidate
        .evidence
        .iter()
        .map(|evidence| match evidence {
            gil::decider::Evidence::Key(key) => Basis::Value {
                field: key.attribute.clone(),
                value: key.value.clone(),
            },
            gil::decider::Evidence::Record { id, similarity } => Basis::Record {
                id: id.clone(),
                similarity: *similarity,
            },
        })
        .collect()
}

/// The settlements a field's precision is counted on when its thresholds are chosen — Gil's
/// [`gil::replay::Choice::counting`]: values settled with no suggestion in view, and checks ([`crate::Recheck`]).
/// Counting every settlement would count values people took from the suggestions themselves, so a field whose
/// suggestions are easily taken would promise more than it keeps.
pub const COUNTED: &[gil::schema::SettlementKind] = &[
    gil::schema::SettlementKind::Enter,
    gil::schema::SettlementKind::Check,
];

/// One decision as Gil's [`gil::usage::usage`] counts it: the proposal shown for the field and how the field was
/// settled, if it was. The answer is the decider's suggestion shown — a class counts as answered, and a value taken
/// within it as accepted, as [`crate::Draft::settle`] settles it. A field settled with no proposal shown is a decision
/// with no answer: pass [`Proposal::abstain`]. No promise is carried; the counts rest on the settlements alone.
pub fn decision<'a>(
    proposal: &'a Proposal,
    settlement: Option<&'a Settlement>,
) -> gil::usage::Decision<'a> {
    gil::usage::Decision {
        attribute: &proposal.field,
        answer: proposal
            .suggestion
            .as_ref()
            .filter(|s| s.origin == crate::provenance::Origin::Decider)
            .map(|s| s.value.as_str()),
        settled: settlement.and_then(|s| s.value.as_deref()),
        settlement: settlement.map(|s| s.kind.into()),
        probability: settlement.and_then(|s| s.probability).unwrap_or(1.0),
        promise: None,
    }
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
            SettlementKind::Check => Self::Check,
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
            SettlementKind::Check => Gil::check(value, self.probability.unwrap_or(1.0)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::provenance::{Draft, SettledBy};
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
            SettlementKind::Check,
        ] {
            let gil: gil::schema::SettlementKind = kind.into();
            assert_eq!(format!("{gil:?}"), format!("{kind:?}"));
        }
    }

    fn answer(candidates: Vec<gil::decider::Candidate>) -> gil::decider::Answer {
        gil::decider::Answer {
            attribute: "owner".into(),
            source: candidates
                .first()
                .map_or(gil::decider::Source::None, |c| c.source),
            candidates,
            coarse: None,
            policy: gil::schema::AttributePolicy::Suggest,
            needs_external: None,
        }
    }

    fn candidate(value: &str, trusted: bool) -> gil::decider::Candidate {
        gil::decider::Candidate {
            value: value.into(),
            score: 0.9,
            source: gil::decider::Source::SettledFieldMemory,
            evidence: Some(gil::decider::Evidence::Key(gil::key_memory::Key {
                attribute: "customer".into(),
                value: "Acme".into(),
            })),
            trusted,
        }
    }

    fn owner(policy: Option<Policy>) -> ResolvedField {
        let mut owner = Field::choice("owner", ["kim", "lee", "park"]);
        owner.policy = policy;
        resolved(vec![Field::new("customer", FieldKind::Text), owner]).remove(1)
    }

    #[test]
    fn shows_the_trusted_value_with_what_it_rests_on() {
        let shown = proposal(&owner(None), &answer(vec![candidate("kim", true)]), None);
        assert_eq!(shown.suggestion, Some(Suggestion::new("kim")));
        assert!(shown.prefill);
        assert_eq!(shown.layer, Some(Layer::Key));
        assert_eq!(
            shown.basis,
            [Basis::Value {
                field: "customer".into(),
                value: "Acme".into()
            }]
        );
        assert_eq!(shown.abstain, None);
    }

    #[test]
    fn a_field_to_confirm_is_never_put_in_by_the_host() {
        let shown = proposal(
            &owner(Some(Policy::Confirm)),
            &answer(vec![candidate("kim", true)]),
            None,
        );
        assert!(shown.suggestion.is_some());
        assert!(!shown.prefill);
    }

    #[test]
    fn says_why_nothing_is_shown() {
        let why = |a: gil::decider::Answer, allowed: Option<&[String]>| {
            proposal(&owner(None), &a, allowed).abstain
        };
        assert_eq!(why(answer(vec![]), None), Some(Abstain::NoEvidence));
        assert_eq!(
            why(answer(vec![candidate("kim", false)]), None),
            Some(Abstain::Unsure)
        );
        let lee = ["lee".to_owned()];
        assert_eq!(
            why(answer(vec![candidate("kim", true)]), Some(&lee)),
            Some(Abstain::NotAllowed)
        );
        assert_eq!(
            proposal(
                &owner(Some(Policy::Off)),
                &answer(vec![candidate("kim", true)]),
                None
            )
            .abstain,
            Some(Abstain::Off)
        );

        let mut asking = answer(vec![]);
        asking.needs_external = Some(vec![("customer".into(), "Acme".into())]);
        let shown = proposal(&owner(None), &asking, None);
        assert_eq!(shown.abstain, Some(Abstain::NeedsJudgement));
        assert_eq!(shown.asks, [("customer".to_owned(), "Acme".to_owned())]);
    }

    #[test]
    fn offers_the_class_when_only_the_class_is_trusted() {
        let mut classed = answer(vec![candidate("P10", false)]);
        classed.coarse = Some(candidate("P", true));
        let shown = proposal(&owner(None), &classed, None);
        assert_eq!(shown.suggestion, Some(Suggestion::class("P")));
        assert!(!shown.prefill, "a class is not a value to put in");

        let only_q = ["Q20".to_owned()];
        assert_eq!(
            proposal(&owner(None), &classed, Some(&only_q)).abstain,
            Some(Abstain::NotAllowed)
        );
    }

    #[test]
    fn counts_what_the_answers_came_to() {
        let kim = proposal(&owner(None), &answer(vec![candidate("kim", true)]), None);
        let none = Proposal::abstain("owner", Abstain::NoEvidence);
        let mut draft = Draft::new();
        draft.show("owner", kim.suggestion.clone().unwrap());
        let taken = draft.settle(
            ["owner"],
            &[("owner".to_owned(), FieldValue::from("kim"))].into(),
            SettledBy::Person,
        );
        let changed = draft.settle(
            ["owner"],
            &[("owner".to_owned(), FieldValue::from("lee"))].into(),
            SettledBy::Person,
        );
        let typed = Draft::new().settle(
            ["owner"],
            &[("owner".to_owned(), FieldValue::from("park"))].into(),
            SettledBy::Person,
        );

        let counts = gil::usage::usage([
            decision(&kim, taken.first()),
            decision(&kim, changed.first()),
            decision(&none, typed.first()),
            decision(&kim, None),
        ]);
        let owner = &counts["owner"];
        assert_eq!(
            (
                owner.decisions,
                owner.answered,
                owner.accepted,
                owner.corrected,
                owner.entered
            ),
            (4, 3, 1, 1, 1)
        );
        assert_eq!(owner.entered_over_answer, 0);
    }

    #[test]
    fn a_held_answer_settles_as_a_check_and_counts_as_one() {
        let kim = proposal(&owner(None), &answer(vec![candidate("kim", true)]), None);
        let probability = Recheck { rate: 0.25 }.draw(&kim, 0.1).unwrap();
        let mut draft = Draft::new();
        draft.hold("owner", probability);
        let checked = draft.settle(
            ["owner"],
            &[("owner".to_owned(), FieldValue::from("kim"))].into(),
            SettledBy::Person,
        );
        assert_eq!(
            checked[0].to_gil(),
            gil::schema::Settlement::check("kim", 0.25)
        );

        let counts = gil::usage::usage([decision(&kim, checked.first())]);
        let owner = &counts["owner"];
        assert_eq!((owner.checked, owner.checked_right), (1, 1));
        assert_eq!(owner.judged_weight, 4.0);
        assert!(COUNTED.contains(&gil::schema::SettlementKind::Check));
    }
}
