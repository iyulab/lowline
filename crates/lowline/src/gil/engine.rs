//! One form's suggestions over the records settled for it, as a host keeps them between calls.

use std::collections::{BTreeMap, BTreeSet};

use gil::decider::{Decider, ExternalCandidate};
use gil::key_memory::{KeyMemory, Lookup};
use gil::lexical_memory::LexicalMemory;
use gil::schema::{AttributePolicy, AttributeRole, Record, Schema};
use gil::tuning::Tuning;

use super::{FieldReport, Tune, Tuned, annotate, proposal, record, schema, tune};
use crate::proposal::{Layer, Proposal};
use crate::provenance::{Draft, Fit, Origin, SettledBy, Settlement, SettlementKind};
use crate::schema::{FieldKind, ResolvedField, Role};
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
/// let _to_store = engine.settle("new", &saved, &Draft::new(), SettledBy::Person, 0).unwrap();
/// assert_eq!(engine.settled(), 1);
/// ```
pub struct Engine {
    fields: Vec<ResolvedField>,
    schema: Schema,
    decider: Decider,
    tune: Tune,
    tuned: Option<Tuned>,
    learned: BTreeSet<String>,
    form_version: Option<String>,
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
            tuned: None,
            learned: BTreeSet::new(),
            form_version: None,
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
        self.tuned.as_ref().map(|t| &t.tuning)
    }

    /// How each decided field's replays went when the thresholds were chosen — kept with the tuning, so an engine
    /// restored from storage says the same; `None` while none were chosen or restored.
    pub fn report(&self) -> Option<&[FieldReport]> {
        self.tuned.as_ref().map(|t| t.report.as_slice())
    }

    /// The version of the form's code lists the records it settles are written under: it changes when a value comes to
    /// mean something else (a code renumbered, merged or split), not when only a label or the layout changes. A record
    /// settled by [`Engine::settle`] carries it, so a replay can tell the stretches apart. None by default.
    #[must_use]
    pub fn with_form_version(mut self, version: impl Into<String>) -> Self {
        self.form_version = Some(version.into());
        self
    }

    /// The version of the form's code lists, when the host gave one.
    pub fn form_version(&self) -> Option<&str> {
        self.form_version.as_deref()
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

    /// Forgets the records `ids` taught — records deleted since they were learned — so the engine answers as if they
    /// had never been learned, without learning the rest again. An id it never learned is passed by.
    pub fn forget<S: AsRef<str>>(&mut self, ids: &[S]) {
        for id in ids.iter().map(AsRef::as_ref) {
            if self.learned.remove(id) {
                self.decider.remove(&self.schema, id);
            }
        }
    }

    /// Puts back a tuning the host stored, setting its thresholds on the schema; `None` leaves the engine untuned.
    /// Whether it still stands is [`Engine::stale`]'s to say — restore it after learning the stored records, so that it
    /// is judged on them. A tuning the form can no longer take — one naming key fields it has dropped — is not put
    /// back: the engine stays untuned, and [`Engine::stale`] says so.
    pub fn restore(&mut self, tuned: Option<Tuned>) {
        self.tuned = match tuned {
            Some(mut tuned) => match tuned.tuning.apply(&self.schema) {
                Ok(schema) => {
                    // A tuning stored before a class could be promised by the similar records that back it trusts
                    // them for a class without saying how often they are right: chosen again, as one never chosen.
                    let unpromised = tuned.report.iter().any(|field| {
                        field.coarse_similar.is_none()
                            && schema.attributes().iter().any(|a| {
                                a.name == field.field
                                    && a.coarse
                                        .as_ref()
                                        .is_some_and(|c| c.memory_threshold.is_some())
                            })
                    });
                    if unpromised {
                        None
                    } else {
                        self.schema = schema;
                        // A tuning stored before reports said what they were chosen on says it in the tuning.
                        for field in &mut tuned.report {
                            field.chosen_on = tuned.tuning.settled;
                        }
                        Some(tuned)
                    }
                }
                Err(_) => None,
            },
            None => None,
        };
    }

    /// Why the thresholds should be chosen again, or `None` while they stand: none chosen yet, or Gil's reason — another
    /// version of it, a changed form, or the learned records grown or shrunk by a tenth since the choice.
    pub fn stale(&self) -> Option<Stale> {
        match &self.tuned {
            None => Some(Stale::Untuned),
            Some(tuned) => tuned
                .tuning
                .stale(&self.schema, self.settled())
                .map(Stale::Tuning),
        }
    }

    /// Chooses the decided fields' thresholds again on the settled `records` — all of them, as the host stores them —
    /// sets them on the schema and answers the tuning for the host to store. The records are learned as well, so an
    /// engine handed them here needs no [`Engine::learn`] for them.
    pub fn tune(&mut self, records: &[Record]) -> &Tuned {
        self.learn(records);
        let tuned = self.choose(records);
        self.restore(Some(tuned));
        self.tuned.as_ref().expect("restored just now")
    }

    /// The tuning [`Engine::tune`] would choose on `records`, leaving the engine as it is — for a host that chooses
    /// while the engine goes on answering (it reads the engine only), then puts the result in with [`Engine::restore`].
    /// The records should be the ones the engine has learned: the tuning stands for as many records as it was chosen
    /// on.
    pub fn choose(&self, records: &[Record]) -> Tuned {
        let mut schema = self.schema.clone();
        tune(&mut schema, &self.fields, records, &self.tune)
    }

    /// What the answers came to on `records`, counted without content, by decided field: how often an answer was
    /// offered, how people settled it, and how the precision it realized compares with the one it promised
    /// ([`gil::usage::AttributeUsage`]). The records are the settled lines the host stores, each saying what was in
    /// view and what the person did — [`Engine::settle`] writes that. Nothing about the engine changes.
    pub fn usage(&self, records: &[Record]) -> BTreeMap<String, gil::usage::AttributeUsage> {
        gil::usage::usage(records)
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
        let shown = self
            .decider
            .answer(&self.schema, id, &known.values, &known.sets)
            .iter()
            .filter_map(|answer| {
                let field = self
                    .fields
                    .iter()
                    .find(|f| f.field.name == answer.attribute)?;
                Some(self.promised(
                    proposal(
                        field,
                        answer,
                        allowed.get(&answer.attribute).map(Vec::as_slice),
                    ),
                    None,
                ))
            })
            .collect();
        self.together(id, values, allowed, shown)
    }

    /// `shown` with each group of fields settled together ([`crate::Field::together`]) held back where one of its open
    /// fields has no suggestion: the group's other fields are shown none either ([`crate::Abstain::Together`], naming
    /// the fields without one). A field a person has filled is not open, so it is not counted; a field never suggested
    /// ([`crate::Policy::Off`]) is no part of the group. Nor does a field without one hold the group when it is only
    /// waiting on the group: given the values suggested for the group's other fields, it would be answered — an
    /// occupation the records answer once the industry suggested is settled. The industry is shown, and the occupation
    /// is asked again once a person has settled it.
    fn together(
        &self,
        id: &str,
        values: &BTreeMap<String, FieldValue>,
        allowed: &BTreeMap<String, Vec<String>>,
        mut shown: Vec<Proposal>,
    ) -> Vec<Proposal> {
        let group_of = |name: &str| {
            self.fields
                .iter()
                .find(|f| f.field.name == name && f.policy != crate::Policy::Off)
                .and_then(|f| f.field.together.clone())
        };
        let groups: Vec<Option<String>> = shown.iter().map(|p| group_of(&p.field)).collect();
        let waits_on_group = |field: &str, group: &str| {
            let mut settled = values.clone();
            for (q, g) in shown.iter().zip(&groups) {
                let one = self
                    .fields
                    .iter()
                    .any(|f| f.field.name == q.field && !f.field.multiple);
                if let (Some(suggestion), true, true) =
                    (&q.suggestion, g.as_deref() == Some(group), one)
                {
                    settled.insert(q.field.clone(), FieldValue::One(suggestion.value.clone()));
                }
            }
            if settled.len() == values.len() {
                return false;
            }
            let Some(resolved) = self.fields.iter().find(|f| f.field.name == field) else {
                return false;
            };
            let known = record(id, &self.fields, &settled, &[], 0);
            let answer =
                self.decider
                    .answer_one(&self.schema, id, field, &known.values, &known.sets, None);
            proposal(resolved, &answer, allowed.get(field).map(Vec::as_slice))
                .suggestion
                .is_some()
        };
        let unanswered: Vec<(String, String)> = shown
            .iter()
            .zip(&groups)
            .filter(|(p, _)| p.suggestion.is_none())
            .filter_map(|(p, g)| Some((g.clone()?, p.field.clone())))
            .filter(|(g, field)| !waits_on_group(field, g))
            .collect();
        for (p, group) in shown.iter_mut().zip(&groups) {
            let Some(group) = group else { continue };
            if p.suggestion.is_none() {
                continue;
            }
            let with: Vec<String> = unanswered
                .iter()
                .filter(|(g, _)| g == group)
                .map(|(_, field)| field.clone())
                .collect();
            if !with.is_empty() {
                *p = Proposal {
                    with,
                    together: p.together.clone(),
                    ..Proposal::abstain(p.field.clone(), crate::Abstain::Together)
                };
            }
        }
        shown
    }

    /// `shown` with the promise of the threshold its suggestion was held to, from the report of the thresholds chosen:
    /// the key layer's — or, with `typed` characters typed, the threshold for that many — the coarse level's for a
    /// class (the key layer's or the similar records', whichever backs it), the similar records layer's. Nothing for a judgement from outside the records, a value from elsewhere, or
    /// an engine not tuned.
    fn promised(&self, mut shown: Proposal, typed: Option<usize>) -> Proposal {
        let Some(suggestion) = &shown.suggestion else {
            return shown;
        };
        let Some(report) = self
            .tuned
            .as_ref()
            .and_then(|t| t.report.iter().find(|r| r.field == shown.field))
        else {
            return shown;
        };
        let choice = match (suggestion.origin, suggestion.fit, shown.layer) {
            // A class is promised by the layer that backs it.
            (Origin::Decider, Fit::Prefix, Some(Layer::Key)) => report.coarse.as_ref(),
            (Origin::Decider, Fit::Prefix, Some(Layer::Similar)) => report.coarse_similar.as_ref(),
            (Origin::Decider, Fit::Exact, Some(Layer::Key)) => match typed {
                Some(length) => report
                    .typed
                    .as_ref()
                    .and_then(|t| t.get(length.checked_sub(1)?))
                    .and_then(Option::as_ref),
                None => report.key.as_ref(),
            },
            (Origin::Decider, Fit::Exact, Some(Layer::Similar)) => report.similar.as_ref(),
            _ => None,
        };
        shown.promise = choice.map(|c| c.promise);
        shown
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
        let attribute = self.schema.attributes().iter().find(|a| a.name == field)?;
        let known = record(id, &self.fields, values, &[], 0);
        let open = attribute.role == AttributeRole::Decided
            && attribute.policy != AttributePolicy::Off
            && (attribute.multiple || !known.values.contains_key(field));
        if !open {
            return None;
        }
        let typed = typed.filter(|t| !t.is_empty());
        // Not typed into, a field settled together with others is shown what the group allows.
        if typed.is_none() && resolved.field.together.is_some() {
            return self
                .propose(id, values, allowed)
                .into_iter()
                .find(|p| p.field == field);
        }
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
        Some(self.promised(
            proposal(resolved, &answer, allowed.get(field).map(Vec::as_slice)),
            typed.map(|t| t.chars().count()),
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
        let attribute = self.schema.attributes().iter().find(|a| a.name == field)?;
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
    /// [`SettlementKind::Enter`], or [`SettlementKind::Set`] for one that takes several), the fields whose answer was
    /// held back for a check while the record was written (`checks`, by field, with the probability each was drawn
    /// with — as [`Draft::hold`] draws them; settled as [`SettlementKind::Check`]) and when, in 100-nanosecond ticks
    /// since the Unix epoch, UTC. Nothing is learned: hand the records to [`Engine::learn`] together, in settlement
    /// order. A field with no value saved is not settled.
    ///
    /// `draft`, when the host has an account of what was shown, is read as [`Engine::settle`] reads it, for a record a
    /// person settled: the answer in view for each field, the layer and promise reported for it, the time to settle it,
    /// the order values arrived in, who settled it and the batch. Whatever it does not report is left out of the record;
    /// `settled` and `checks` stay the account of how each field was settled. The record is not
    /// stamped with the form's version: the engine knows the version it holds now, not the one the record was settled
    /// under.
    ///
    /// The error names the first thing the form does not hold: a value for a field it does not have, several values
    /// for a field that takes one, a settlement or check for a field it does not decide, a check drawn with a
    /// probability outside (0, 1], a field both settled and checked, or a check said in `settled` — it carries the
    /// probability it was drawn with, so it is given in `checks`.
    pub fn record(
        &self,
        id: &str,
        saved: &BTreeMap<String, FieldValue>,
        settled: &BTreeMap<String, SettlementKind>,
        checks: &BTreeMap<String, f64>,
        draft: Option<&Draft>,
        settled_at: i64,
    ) -> Result<Record, String> {
        self.check_saved(id, saved, false)?;
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
                    "record '{id}' settles '{name}' as a check, which carries the probability it was drawn with — \
                     give it in the checks"
                ));
            }
        }
        for (name, probability) in checks {
            if !self
                .fields
                .iter()
                .any(|f| &f.field.name == name && f.role == Role::Decided)
            {
                return Err(format!(
                    "record '{id}' checks '{name}', which the form does not decide"
                ));
            }
            if !(*probability > 0.0 && *probability <= 1.0) {
                return Err(format!(
                    "record '{id}' checks '{name}' drawn with {probability}, not a probability above 0 and at most 1"
                ));
            }
            if settled.contains_key(name) {
                return Err(format!("record '{id}' both settles and checks '{name}'"));
            }
        }
        let settlements: Vec<Settlement> = self
            .fields
            .iter()
            .filter(|f| f.role == Role::Decided)
            .filter(|f| saved.get(&f.field.name).is_some_and(|v| !v.is_empty()))
            .map(|f| {
                let name = &f.field.name;
                let probability = checks.get(name).copied();
                let kind = match (probability, settled.get(name)) {
                    (Some(_), _) => SettlementKind::Check,
                    (None, Some(kind)) => *kind,
                    (None, None) if f.field.multiple => SettlementKind::Set,
                    (None, None) => SettlementKind::Enter,
                };
                Settlement {
                    field: name.clone(),
                    kind,
                    value: None,
                    values: None,
                    suggested: None,
                    probability,
                }
            })
            .collect();
        let mut made = record(id, &self.fields, saved, &settlements, settled_at);
        if let Some(draft) = draft {
            annotate(&mut made, draft, &settlements, SettledBy::Person);
        }
        Ok(made)
    }

    /// Settles the record `id` as saved — its `saved` values, and the `draft` that kept what was shown for it and what
    /// happened to that — learns it, and gives back the record for the host to store. `settled_at` is in 100-nanosecond
    /// ticks since the Unix epoch, UTC. The thresholds are not chosen again here: [`Engine::stale`] says when they should
    /// be. A value the form does not hold is refused, and nothing is learned: a field it does not have, several values
    /// for a field that takes one, or a value none of a choice field's choices (unless the field also takes others).
    pub fn settle(
        &mut self,
        id: &str,
        saved: &BTreeMap<String, FieldValue>,
        draft: &Draft,
        by: SettledBy,
        settled_at: i64,
    ) -> Result<Record, String> {
        self.check_saved(id, saved, true)?;
        let decided = self
            .fields
            .iter()
            .filter(|f| f.role == Role::Decided)
            .map(|f| f.field.name.as_str());
        let settlements = draft.settle(decided, saved, by);
        let mut settled = record(id, &self.fields, saved, &settlements, settled_at);
        annotate(&mut settled, draft, &settlements, by);
        settled.form_version.clone_from(&self.form_version);
        self.learn(std::slice::from_ref(&settled));
        Ok(settled)
    }

    /// Refuses values the form cannot hold, before anything is learned: a field the form does not have, several values
    /// for a field that takes one, and — with `choices`, for a save made now — a value of a choice field that is none of
    /// its choices (unless the field also takes others). What a person confirmed is what the engine learns, so a value
    /// outside the form must not be learned as one. A record settled earlier may hold a choice the form has dropped
    /// since: that is its history, not an error, and the engine never suggests it.
    fn check_saved(
        &self,
        id: &str,
        saved: &BTreeMap<String, FieldValue>,
        choices: bool,
    ) -> Result<(), String> {
        for (name, value) in saved {
            let Some(field) = self.fields.iter().find(|f| &f.field.name == name) else {
                return Err(format!(
                    "record '{id}' has a value for '{name}', which the form does not have"
                ));
            };
            let field = &field.field;
            if matches!(value, FieldValue::Many(_)) && !field.multiple {
                return Err(format!(
                    "record '{id}' has several values for '{name}', which takes one"
                ));
            }
            if !choices || field.kind != FieldKind::Choice || field.open || field.choices.is_empty()
            {
                continue;
            }
            let texts = match value {
                FieldValue::One(one) => std::slice::from_ref(one),
                FieldValue::Many(many) => many.as_slice(),
            };
            if let Some(outside) = texts
                .iter()
                .find(|t| !t.is_empty() && !field.choices.contains(t))
            {
                return Err(format!(
                    "record '{id}' has '{outside}' for '{name}', which is none of its choices"
                ));
            }
        }
        Ok(())
    }
}
