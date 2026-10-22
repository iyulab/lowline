//! One form's suggestions over the records settled for it, as a host keeps them between calls.

use std::collections::{BTreeMap, BTreeSet};

use gil::decider::{Decider, ExternalCandidate};
use gil::key_memory::{KeyMemory, Lookup};
use gil::lexical_memory::LexicalMemory;
use gil::schema::{AttributePolicy, AttributeRole, Record, Schema};
use gil::tuning::Tuning;

use super::{Tune, proposal, record, schema, tune};
use crate::proposal::Proposal;
use crate::provenance::{Draft, SettledBy, Settlement, SettlementKind};
use crate::schema::{ResolvedField, Role};
use crate::value::FieldValue;

/// One form's round with the Gil decider, in one place: the records settled for it learned, its decided fields
/// answered and shown, a person's save settled and learned from, and its thresholds chosen again when they no longer
/// stand. Everything a host would otherwise wire from [`schema`], [`proposal`], [`record`] and [`tune`] by hand.
///
/// The engine keeps what answers — the schema with its thresholds and the memories — but not the records themselves
/// nor anything else that outlives the process. Storing them is the host's: it hands the stored records to
/// [`Engine::learn`] and the stored tuning to [`Engine::restore`] when it starts, stores each record [`Engine::settle`]
/// gives back, and stores the tuning [`Engine::tune`] gives back. A host that keeps records apart — one store per
/// workplace, say — keeps one engine per form and store.
///
/// ```
/// # use std::collections::BTreeMap;
/// use lowline::{Draft, Field, FieldKind, FieldValue, Form, Inference, SettledBy, gil::{Engine, Tune}};
///
/// let form = Form { fields: vec![Field::new("customer", FieldKind::Text), Field::choice("owner", ["kim", "lee"])] };
/// let mut engine = Engine::new("intake", form.resolve(Inference::ClosedChoices).unwrap(), Tune::default()).unwrap();
///
/// // At start-up: the stored records, then the stored tuning — chosen again when it no longer stands.
/// let stored: Vec<gil::schema::Record> = Vec::new();
/// engine.learn(&stored);
/// engine.restore(None);
/// if engine.stale().is_some() {
///     let _to_store = engine.tune(&stored);
/// }
///
/// // A record being written: what to show for its decided fields, then the person's save.
/// let values = BTreeMap::from([("customer".to_owned(), FieldValue::from("Acme"))]);
/// let shown = engine.propose("new", &values, &BTreeMap::new());
/// assert_eq!(shown[0].field, "owner");
/// let saved = BTreeMap::from([
///     ("customer".to_owned(), FieldValue::from("Acme")),
///     ("owner".to_owned(), FieldValue::from("kim")),
/// ]);
/// let _to_store = engine.settle("new", &saved, &Draft::new(), SettledBy::Person, 0);
/// assert_eq!(engine.settled(), 1);
/// ```
pub struct Engine {
    fields: Vec<ResolvedField>,
    schema: Schema,
    decider: Decider,
    tune: Tune,
    tuning: Option<Tuning>,
    learned: BTreeSet<String>,
}

/// Why an engine's thresholds should be chosen again ([`Engine::stale`]).
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum Stale {
    /// None were chosen, or none were restored.
    Untuned,
    /// The tuning no longer stands, for the reason Gil gives.
    Tuning(gil::tuning::Stale),
}

impl Engine {
    /// An engine for the resolved form `fields`, under the schema name `name` — the name the decider's memories are kept
    /// under, so two forms of one host take different names. It answers nothing until records are learned and its
    /// thresholds chosen. The error is Gil's, naming the first rule the form breaks for it.
    pub fn new(name: &str, fields: Vec<ResolvedField>, tune: Tune) -> Result<Self, String> {
        let schema = schema(name, &fields)?;
        Ok(Self {
            fields,
            schema,
            decider: Decider::new(KeyMemory::default(), Some(LexicalMemory::default())),
            tune,
            tuning: None,
            learned: BTreeSet::new(),
        })
    }

    /// The resolved form.
    pub fn fields(&self) -> &[ResolvedField] {
        &self.fields
    }

    /// The schema the decider answers with, its thresholds as last chosen or restored.
    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    /// The tuning the thresholds come from, if one was chosen or restored.
    pub fn tuning(&self) -> Option<&Tuning> {
        self.tuning.as_ref()
    }

    /// How many records the engine has learned: one per record id, a record learned again replacing the earlier one.
    pub fn settled(&self) -> usize {
        self.learned.len()
    }

    /// Learns settled `records` — the stored ones at start-up, or ones settled elsewhere since. A record whose id was
    /// learned before replaces what that one taught.
    pub fn learn(&mut self, records: &[Record]) {
        self.decider.rebuild(&self.schema, records);
        self.learned.extend(records.iter().map(|r| r.id.clone()));
    }

    /// Puts back a tuning the host stored, setting its thresholds on the schema; `None` leaves the engine untuned.
    /// Whether it still stands is [`Engine::stale`]'s to say — restore it after learning the stored records, so that it
    /// is judged on them.
    pub fn restore(&mut self, tuning: Option<Tuning>) {
        if let Some(tuning) = &tuning {
            tuning.apply(&mut self.schema);
        }
        self.tuning = tuning;
    }

    /// Why the thresholds should be chosen again, or `None` while they stand: none chosen yet, or Gil's reason — another
    /// version of it, a changed form, or the learned records grown or shrunk by a tenth since the choice.
    pub fn stale(&self) -> Option<Stale> {
        match &self.tuning {
            None => Some(Stale::Untuned),
            Some(tuning) => tuning
                .stale(&self.schema, self.settled())
                .map(Stale::Tuning),
        }
    }

    /// Chooses the decided fields' thresholds again on the settled `records` — all of them, as the host stores them —
    /// sets them on the schema and answers the tuning for the host to store. The records are learned as well, so an
    /// engine handed them here needs no [`Engine::learn`] for them.
    pub fn tune(&mut self, records: &[Record]) -> &Tuning {
        self.learn(records);
        let tuning = self.choose(records);
        self.restore(Some(tuning));
        self.tuning.as_ref().expect("restored just now")
    }

    /// The tuning [`Engine::tune`] would choose on `records`, leaving the engine as it is — for a host that chooses
    /// while the engine goes on answering (it reads the engine only), then puts the result in with [`Engine::restore`].
    /// The records should be the ones the engine has learned: the tuning stands for as many records as it was chosen
    /// on.
    pub fn choose(&self, records: &[Record]) -> Tuning {
        let mut schema = self.schema.clone();
        tune(&mut schema, &self.fields, records, &self.tune)
    }

    /// What to show for each decided field of the record `id` that is still open, given its `values` so far — in the
    /// form's order. A decided field that takes one value and already has one is not answered. `allowed` holds, by
    /// field, the choices this person may pick now (the host's permissions and active filters); a field it leaves out
    /// may take any value. The record's own saved version, if it was learned, is not evidence for itself.
    pub fn propose(
        &self,
        id: &str,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
    ) -> Vec<Proposal> {
        let known = record(id, &self.fields, values, &[], 0);
        self.decider
            .answer(&self.schema, id, &known.values, &known.sets)
            .iter()
            .filter_map(|answer| {
                let field = self
                    .fields
                    .iter()
                    .find(|f| f.field.name == answer.attribute)?;
                Some(proposal(
                    field,
                    answer,
                    allowed.get(&answer.attribute).map(Vec::as_slice),
                ))
            })
            .collect()
    }

    /// What to show for the one decided field `field` of the record `id`, given its `values` so far and `typed`, the
    /// text a person has typed into it so far — asked again with each character while the field stays open. With text
    /// typed, only a value that begins with it is suggested (ignoring case), from the values settled alongside alone,
    /// held to the threshold chosen for that many characters; a field that is not written out as free text, or typed
    /// past the lengths thresholds were chosen for ([`Tune::typed_longest`]), is answered nothing while typed into
    /// ([`crate::Abstain::Unsure`]). Without text typed it is the field's proposal among [`Engine::propose`]'s. `values`
    /// and `allowed` are as [`Engine::propose`] reads them. `None` when `field` is not a decided field still open.
    pub fn propose_field(
        &self,
        id: &str,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
        field: &str,
        typed: Option<&str>,
    ) -> Option<Proposal> {
        let resolved = self.fields.iter().find(|f| f.field.name == field)?;
        let attribute = self.schema.attributes.iter().find(|a| a.name == field)?;
        let known = record(id, &self.fields, values, &[], 0);
        let open = attribute.role == AttributeRole::Decided
            && attribute.policy != AttributePolicy::Off
            && (attribute.multiple || !known.values.contains_key(field));
        if !open {
            return None;
        }
        let typed = typed.filter(|t| !t.is_empty());
        if let Some(text) = typed {
            let length = text.chars().count();
            let held = attribute
                .typed_key_thresholds
                .as_ref()
                .and_then(|t| t.get(length - 1))
                .is_some();
            if !held {
                return Some(Proposal::abstain(field, crate::Abstain::Unsure));
            }
        }
        let answer =
            self.decider
                .answer_one(&self.schema, id, field, &known.values, &known.sets, typed);
        Some(proposal(
            resolved,
            &answer,
            allowed.get(field).map(Vec::as_slice),
        ))
    }

    /// The fields a host's model may fill for a record holding `values` — see [`crate::fill::describe`].
    pub fn describe(
        &self,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
    ) -> Vec<crate::fill::FillField> {
        crate::fill::describe(&self.fields, values, allowed)
    }

    /// What to show for each field the host's model answered — see [`crate::fill::fill`].
    pub fn fill(
        &self,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
        answered: &BTreeMap<String, FieldValue>,
    ) -> Vec<Proposal> {
        crate::fill::fill(&self.fields, values, allowed, answered)
    }

    /// What to show for the decided field `field` of the record `id` once the host's model has judged it — the answer to
    /// a proposal that asked for a judgement ([`crate::Abstain::NeedsJudgement`], with the fields and values the model
    /// should read in [`Proposal::asks`]). `ranked` holds the model's values, best first, each with its probability on
    /// the model's own scale and whether the model trusts it. They join the decider's candidates where a judgement
    /// always does — after values a memory trusts, before the guesses — and values outside the field's choices are
    /// left out; a trusted one is shown as the decider's answer from the [`crate::Layer::Judgement`] layer, so a person
    /// taking it settles it as they would any other answer. Where a memory has evidence the judgement changes nothing.
    /// `values` and `allowed` are as [`Engine::propose`] reads them. `None` when `field` is not a decided field still
    /// open: not on the form, not decided, off, or holding its one value already.
    pub fn offer(
        &self,
        id: &str,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
        field: &str,
        ranked: &[ExternalCandidate],
    ) -> Option<Proposal> {
        let resolved = self.fields.iter().find(|f| f.field.name == field)?;
        let attribute = self.schema.attributes.iter().find(|a| a.name == field)?;
        let known = record(id, &self.fields, values, &[], 0);
        let open = attribute.role == AttributeRole::Decided
            && attribute.policy != AttributePolicy::Off
            && (attribute.multiple || !known.values.contains_key(field));
        if !open {
            return None;
        }
        let lookup = Lookup::new(&self.schema, field, &known.values)
            .sets(&known.sets)
            .excluding(Some(id));
        let answer = self.decider.offer_external(&lookup, ranked);
        Some(proposal(
            resolved,
            &answer,
            allowed.get(field).map(Vec::as_slice),
        ))
    }

    /// The record to store for `id`, settled elsewhere — for a host whose records are kept somewhere of its own (files,
    /// an existing database) and that builds the engine's store from them: its `saved` values, how each decided field
    /// was settled (`settled`, by field — a decided field left out was settled by a person with nothing in view:
    /// [`SettlementKind::Enter`], or [`SettlementKind::Set`] for one that takes several) and when, in 100-nanosecond ticks since the Unix epoch, UTC. Nothing is learned: hand
    /// the records to [`Engine::learn`] together, in settlement order. A field with no value saved is not settled.
    ///
    /// The error names the first thing the form does not hold: a value for a field it does not have, several values
    /// for a field that takes one, a settlement for a field it does not decide, or a check — a check is drawn while a
    /// record is written ([`Draft::hold`]) and carries the probability it was drawn with, so it is settled through a
    /// draft.
    pub fn record(
        &self,
        id: &str,
        saved: &BTreeMap<String, FieldValue>,
        settled: &BTreeMap<String, SettlementKind>,
        settled_at: i64,
    ) -> Result<Record, String> {
        for (name, value) in saved {
            let Some(field) = self.fields.iter().find(|f| &f.field.name == name) else {
                return Err(format!(
                    "record '{id}' has a value for '{name}', which the form does not have"
                ));
            };
            if matches!(value, FieldValue::Many(_)) && !field.field.multiple {
                return Err(format!(
                    "record '{id}' has several values for '{name}', which takes one"
                ));
            }
        }
        for (name, kind) in settled {
            if !self
                .fields
                .iter()
                .any(|f| &f.field.name == name && f.role == Role::Decided)
            {
                return Err(format!(
                    "record '{id}' says how '{name}' was settled, which the form does not decide"
                ));
            }
            if *kind == SettlementKind::Check {
                return Err(format!(
                    "record '{id}' settles '{name}' as a check, which is drawn while a record is written — settle it \
                     through a draft"
                ));
            }
        }
        let settlements: Vec<Settlement> = self
            .fields
            .iter()
            .filter(|f| f.role == Role::Decided)
            .filter(|f| saved.get(&f.field.name).is_some_and(|v| !v.is_empty()))
            .map(|f| {
                let name = &f.field.name;
                Settlement {
                    field: name.clone(),
                    kind: settled.get(name).copied().unwrap_or(if f.field.multiple {
                        SettlementKind::Set
                    } else {
                        SettlementKind::Enter
                    }),
                    value: None,
                    values: None,
                    suggested: None,
                    probability: None,
                }
            })
            .collect();
        Ok(record(id, &self.fields, saved, &settlements, settled_at))
    }

    /// Settles the record `id` as saved — its `saved` values, and the `draft` that kept what was shown for it and what
    /// happened to that — learns it, and gives back the record for the host to store. `settled_at` is in 100-nanosecond
    /// ticks since the Unix epoch, UTC. The thresholds are not chosen again here: [`Engine::stale`] says when they should
    /// be.
    pub fn settle(
        &mut self,
        id: &str,
        saved: &BTreeMap<String, FieldValue>,
        draft: &Draft,
        by: SettledBy,
        settled_at: i64,
    ) -> Record {
        let decided = self
            .fields
            .iter()
            .filter(|f| f.role == Role::Decided)
            .map(|f| f.field.name.as_str());
        let settlements = draft.settle(decided, saved, by);
        let settled = record(id, &self.fields, saved, &settlements, settled_at);
        self.learn(std::slice::from_ref(&settled));
        settled
    }
}
