//! A host that keeps its record lines as JSON reads them back with the engine's own record type and aggregates them —
//! no dependency on the decider of its own.
#![cfg(all(feature = "gil", feature = "serde"))]

use lowline::gil::{Record, aggregate};

const LINES: &str = r#"
{"id":"r-1","values":{"customer":"Acme","owner":"kim"},"sets":{},"settled_at":17941210500843130,"settlements":{"owner":"Enter"},"probabilities":{},"arrival":null,"form_version":"intake-2"}
{"id":"r-2","values":{"customer":"Beta","owner":"lee"},"sets":{},"settled_at":17941211100843130,"settlements":{"owner":"Enter"},"probabilities":{},"arrival":null,"form_version":"intake-2"}
"#;

#[test]
fn stored_lines_read_back_as_records_and_aggregate() {
    let records = LINES
        .lines()
        .filter(|line| !line.is_empty())
        .map(serde_json::from_str::<Record>)
        .collect::<Result<Vec<_>, _>>()
        .expect("each stored line reads as a record");

    let aggregate = aggregate(&records);

    assert_eq!(aggregate.decisions, 2);
    assert_eq!(aggregate.cuts.len(), 1);
    assert_eq!(aggregate.cuts[0].form_version.as_deref(), Some("intake-2"));
    assert_eq!(aggregate.cuts[0].usage["owner"].entered, 2);
}
