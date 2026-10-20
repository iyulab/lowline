use std::fmt;
use std::str::FromStr;

/// How a field is suggested for. Set per field by the form, or by the host for every field of a kind.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Policy {
    /// Never suggest — for fields a record or a model should not decide, such as an assessment of a person.
    Off,
    /// Suggest when the record supports it; the host may put the suggested value in as the field's starting value.
    #[default]
    Offer,
    /// Suggest, but only a person's own act puts the value in — for fields where a wrong value accepted without a
    /// look costs more than typing it.
    Confirm,
}

impl Policy {
    /// The name a form writes for this policy.
    pub const fn as_str(self) -> &'static str {
        match self {
            Policy::Off => "off",
            Policy::Offer => "offer",
            Policy::Confirm => "confirm",
        }
    }

    /// Whether suggestions are shown for the field at all.
    pub const fn shows(self) -> bool {
        !matches!(self, Policy::Off)
    }

    /// Whether the host may put a suggested value into the field without a person taking it.
    pub const fn may_prefill(self) -> bool {
        matches!(self, Policy::Offer)
    }
}

impl fmt::Display for Policy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A policy name that is not `off`, `offer` or `confirm`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsePolicyError(pub String);

impl fmt::Display for ParsePolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "unknown policy `{}` — expected off, offer or confirm",
            self.0
        )
    }
}

impl std::error::Error for ParsePolicyError {}

impl FromStr for Policy {
    type Err = ParsePolicyError;

    /// Reads a policy name as a form writes it; surrounding space and letter case do not matter.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "off" => Ok(Policy::Off),
            "offer" => Ok(Policy::Offer),
            "confirm" => Ok(Policy::Confirm),
            _ => Err(ParsePolicyError(s.to_owned())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_names_a_form_writes() {
        assert_eq!("off".parse(), Ok(Policy::Off));
        assert_eq!(" Offer ".parse(), Ok(Policy::Offer));
        assert_eq!("CONFIRM".parse(), Ok(Policy::Confirm));
        assert_eq!(
            "suggest".parse::<Policy>(),
            Err(ParsePolicyError("suggest".into()))
        );
    }

    #[test]
    fn names_round_trip() {
        for policy in [Policy::Off, Policy::Offer, Policy::Confirm] {
            assert_eq!(policy.to_string().parse(), Ok(policy));
        }
    }

    #[test]
    fn only_offer_lets_the_host_put_a_value_in() {
        assert!(!Policy::Off.shows());
        assert!(Policy::Offer.shows() && Policy::Offer.may_prefill());
        assert!(Policy::Confirm.shows() && !Policy::Confirm.may_prefill());
    }

    #[test]
    fn a_field_is_offered_unless_the_form_says_otherwise() {
        assert_eq!(Policy::default(), Policy::Offer);
    }
}
