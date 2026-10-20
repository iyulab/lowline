//! The Lowline engine core: the parts of a learning form that every host would otherwise write for itself.
//!
//! A host puts a form on screen and shows suggestions for some of its fields. This crate keeps the account of what
//! happened to each suggestion while the record is being written — shown, taken, changed, turned down, or never there
//! because the person typed the value themselves — and, when the record is saved, turns that account into one
//! [`Settlement`] per decided field. A decider learns from those settlements and counts its precision on them, so
//! getting them right is what keeps "it gets better the more it is used" true: a suggestion that was taken must not
//! be counted as a value a person typed on their own.
//!
//! The core does no I/O. Storing records, scheduling, serving and calling models belong to the host.
//!
//! - [`Form`] — the fields a host hands over, in one shape whatever the form was written in;
//!   [`Form::resolve`] works out which fields are decided ([`Inference`]) and how each is suggested for. With the
//!   `formdown` feature, a form written in formdown is read from the JSON its `getSchema()` gives.
//! - [`Policy`] — whether a field is suggested for, and whether the host may put the suggestion in by itself.
//! - [`Draft`] — the account of one record being written; [`Draft::settle`] gives the settlements.

#[cfg(feature = "formdown")]
mod formdown;
mod policy;
mod provenance;
mod schema;
mod value;

#[cfg(feature = "formdown")]
pub use formdown::{FormdownField, FormdownSchema};
pub use policy::{ParsePolicyError, Policy};
pub use provenance::{Draft, Fit, Origin, SettledBy, Settlement, SettlementKind, Suggestion};
pub use schema::{Field, FieldKind, Form, Inference, ResolvedField, Role, SchemaError};
pub use value::FieldValue;
