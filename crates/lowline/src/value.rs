/// The value a field holds: one text, or a set of texts for a field that takes several.
///
/// The engine compares values as text, exactly; a host that wants `"07"` and `"7"` to be the same value writes them
/// the same way before handing them over.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(untagged))]
pub enum FieldValue {
    One(String),
    Many(Vec<String>),
}

impl FieldValue {
    /// Whether the field holds nothing: an empty text or an empty set. An empty field has not been settled.
    pub fn is_empty(&self) -> bool {
        match self {
            FieldValue::One(text) => text.is_empty(),
            FieldValue::Many(texts) => texts.iter().all(String::is_empty),
        }
    }

    /// The texts of a set once each and in order, without empty ones; `None` for a single value.
    pub(crate) fn set(&self) -> Option<Vec<String>> {
        match self {
            FieldValue::One(_) => None,
            FieldValue::Many(texts) => {
                let mut set: Vec<String> =
                    texts.iter().filter(|t| !t.is_empty()).cloned().collect();
                set.sort();
                set.dedup();
                Some(set)
            }
        }
    }

    /// The same value, compared the way the engine compares: a set regardless of order and repeats.
    pub(crate) fn same_as(&self, other: &FieldValue) -> bool {
        match (self, other) {
            (FieldValue::One(a), FieldValue::One(b)) => a == b,
            (FieldValue::Many(_), FieldValue::Many(_)) => self.set() == other.set(),
            _ => false,
        }
    }
}

impl From<&str> for FieldValue {
    fn from(text: &str) -> Self {
        FieldValue::One(text.to_owned())
    }
}

impl From<String> for FieldValue {
    fn from(text: String) -> Self {
        FieldValue::One(text)
    }
}

impl<S: Into<String>> FromIterator<S> for FieldValue {
    fn from_iter<I: IntoIterator<Item = S>>(texts: I) -> Self {
        FieldValue::Many(texts.into_iter().map(Into::into).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_and_empty_set_hold_nothing() {
        assert!(FieldValue::from("").is_empty());
        assert!(FieldValue::Many(vec![]).is_empty());
        assert!(FieldValue::Many(vec![String::new()]).is_empty());
        assert!(!FieldValue::from("a").is_empty());
    }

    #[test]
    fn sets_compare_regardless_of_order_and_repeats() {
        let a: FieldValue = ["b", "a", "a"].into_iter().collect();
        let b: FieldValue = ["a", "b"].into_iter().collect();
        assert!(a.same_as(&b));
        assert!(!a.same_as(&FieldValue::from("a")));
    }
}
