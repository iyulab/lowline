//! One form's suggestions over the records settled for it, as a host keeps them between calls.

use std::collections::{BTreeMap, BTreeSet};

use gil::decider::Decider;
use gil::key_memory::KeyMemory;
use gil::lexical_memory::LexicalMemory;
use gil::schema::{Record, Schema};
use gil::tuning::Tuning;

use super::{Tune, proposal, record, schema, tune};
use crate::proposal::Proposal;
use crate::provenance::{Draft, SettledBy};
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
        let tuning = tune(&mut self.schema, records, &self.tune);
        self.tuning.insert(tuning)
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
