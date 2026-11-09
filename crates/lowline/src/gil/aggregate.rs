//! What a host may send on about how its answers went: the usage counts of its settled records, cut by the week each
//! decision was first settled in and the version of the form it was settled on — no values, no text, no one who
//! settled, no record id.

use std::collections::BTreeMap;

use gil::schema::Record;
use gil::usage::AttributeUsage;

/// The settled records' usage counts ([`gil::usage::usage`]), cut by week and form version. Nothing in it names a
/// record, a value or a person: it is what a host can share about how its answers went, and sending it anywhere is
/// the host's decision — the engine only hands it over.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Aggregate {
    /// How many decisions the records hold: records with distinct ids. A record settled again later (an audit) is the
    /// same decision.
    pub decisions: usize,
    /// The cuts, by week and then form version, oldest first.
    pub cuts: Vec<Cut>,
}

/// The decisions first settled in one week on one version of the form, and what their answers came to.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Cut {
    /// The ISO 8601 week the decisions were first settled in, UTC, such as `2026-W47`.
    pub week: String,
    /// The version of the form the decisions were first settled on; `None` for records that do not say.
    pub form_version: Option<String>,
    /// The usage counts of the cut's decisions, by decided field — each decision's lines together, a later audit's
    /// included, so an audit is counted as one ([`AttributeUsage::audits`]) and not as a decision of its own.
    pub usage: BTreeMap<String, AttributeUsage>,
}

/// Cuts `records` — the settled lines as the host stores them — by the week and form version of each decision's
/// first settlement, and counts each cut's usage. A decision's first settlement is its line with the earliest
/// `settled_at` (of two at the same time, the one passed first); every line of that decision goes into its cut, so a
/// check made later on it is counted as an audit of it.
pub fn aggregate(records: &[Record]) -> Aggregate {
    let mut first: BTreeMap<&str, (i64, usize)> = BTreeMap::new();
    for (at, record) in records.iter().enumerate() {
        first
            .entry(record.id.as_str())
            .and_modify(|seen| {
                if record.settled_at < seen.0 {
                    *seen = (record.settled_at, at);
                }
            })
            .or_insert((record.settled_at, at));
    }

    let mut cuts: BTreeMap<(String, Option<String>), Vec<Record>> = BTreeMap::new();
    for record in records {
        let (settled_at, at) = first[record.id.as_str()];
        let key = (iso_week(settled_at), records[at].form_version.clone());
        cuts.entry(key).or_default().push(record.clone());
    }

    Aggregate {
        decisions: first.len(),
        cuts: cuts
            .into_iter()
            .map(|((week, form_version), lines)| Cut {
                week,
                form_version,
                usage: gil::usage::usage(&lines),
            })
            .collect(),
    }
}

/// The ISO 8601 week, as `YYYY-Www`, of `ticks` — 100-nanosecond ticks since the Unix epoch, UTC.
pub(crate) fn iso_week(ticks: i64) -> String {
    let days = ticks.div_euclid(10_000_000).div_euclid(86_400);
    // 1970-01-01 was a Thursday; ISO weekdays run from Monday = 1.
    let weekday = (days + 3).rem_euclid(7) + 1;
    // The week belongs to the year its Thursday falls in.
    let thursday = days - weekday + 4;
    let (year, ordinal) = year_and_ordinal(thursday);
    format!("{year}-W{:02}", ordinal / 7 + 1)
}

/// The year of `days` since the Unix epoch and the day's place in it, from 0.
fn year_and_ordinal(days: i64) -> (i64, i64) {
    let year = civil_year(days);
    (year, days - days_from_civil(year, 1, 1))
}

/// The proleptic Gregorian year of `days` since the Unix epoch.
fn civil_year(days: i64) -> i64 {
    // Howard Hinnant's civil_from_days, year only.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    yoe + era * 400 + i64::from(month <= 2)
}

/// Days since the Unix epoch of a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticks(year: i64, month: i64, day: i64) -> i64 {
        days_from_civil(year, month, day) * 86_400 * 10_000_000
    }

    #[test]
    fn weeks_are_iso_weeks() {
        assert_eq!(iso_week(ticks(2026, 11, 9)), "2026-W46");
        assert_eq!(iso_week(ticks(2026, 11, 15)), "2026-W46");
        assert_eq!(iso_week(ticks(2026, 11, 16)), "2026-W47");
        // Week 1 is the week with the year's first Thursday: its Monday can be in the year before.
        assert_eq!(iso_week(ticks(2024, 12, 30)), "2025-W01");
        assert_eq!(iso_week(ticks(2021, 1, 3)), "2020-W53");
        assert_eq!(iso_week(ticks(2027, 1, 1)), "2026-W53");
        assert_eq!(iso_week(0), "1970-W01");
        assert_eq!(iso_week(ticks(1969, 12, 28)), "1969-W52");
    }

    fn line(id: &str, at: i64, version: Option<&str>, kind: gil::schema::SettlementKind) -> Record {
        let mut record = Record {
            id: id.into(),
            settled_at: at,
            form_version: version.map(Into::into),
            ..Record::default()
        };
        record.values.insert("owner".into(), "kim".into());
        record.settlements.insert("owner".into(), kind);
        if kind == gil::schema::SettlementKind::Check {
            record.probabilities.insert("owner".into(), 0.1);
            record.suggested.insert("owner".into(), "kim".into());
            record
                .sources
                .insert("owner".into(), gil::decider::Source::KeyMemory);
        }
        record
    }

    #[test]
    fn decisions_are_cut_by_the_week_and_version_they_were_first_settled_in() {
        use gil::schema::SettlementKind::{Check, Enter};
        let records = [
            line("a", ticks(2026, 11, 9), Some("v1"), Enter),
            line("b", ticks(2026, 11, 10), Some("v2"), Enter),
            line("c", ticks(2026, 11, 17), Some("v1"), Enter),
            // An audit of `a` a week later stays with `a`.
            line("a", ticks(2026, 11, 18), Some("v2"), Check),
        ];
        let aggregate = aggregate(&records);
        assert_eq!(aggregate.decisions, 3);
        let keys: Vec<_> = aggregate
            .cuts
            .iter()
            .map(|cut| (cut.week.as_str(), cut.form_version.as_deref()))
            .collect();
        assert_eq!(
            keys,
            [
                ("2026-W46", Some("v1")),
                ("2026-W46", Some("v2")),
                ("2026-W47", Some("v1")),
            ]
        );
        let owner = &aggregate.cuts[0].usage["owner"];
        assert_eq!((owner.decisions, owner.audits), (1, 1));
        assert_eq!(owner.first_checks_without_answer, 0);
    }

    #[test]
    fn nothing_settled_is_nothing_to_send() {
        assert_eq!(aggregate(&[]), Aggregate::default());
    }
}
