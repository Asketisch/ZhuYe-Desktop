//! 提交操作样本由真实协议 serde 检查；不代替端到端执行测试。
use reflect_protocol::Op;
use serde_json::{Value, json};

fn assert_preserved(sample: &Value, actual: &Value, path: &str) {
    match sample {
        Value::Object(fields) => {
            let output = actual
                .as_object()
                .unwrap_or_else(|| panic!("{path} is not an object: {actual}"));
            for (key, value) in fields {
                let nested = format!("{path}.{key}");
                assert_preserved(
                    value,
                    output
                        .get(key)
                        .unwrap_or_else(|| panic!("{nested} was dropped")),
                    &nested,
                );
            }
        }
        Value::Array(items) => {
            let output = actual
                .as_array()
                .unwrap_or_else(|| panic!("{path} is not an array: {actual}"));
            assert_eq!(items.len(), output.len(), "{path}");
            for (index, (item, result)) in items.iter().zip(output).enumerate() {
                assert_preserved(item, result, &format!("{path}[{index}]"));
            }
        }
        _ => assert_eq!(sample, actual, "{path}"),
    }
}

#[test]
fn every_operation_sample_deserializes_and_preserves_supplied_fields() {
    let document: Value =
        serde_json::from_str(include_str!("../../tests/contracts/ops.json")).unwrap();
    let samples = document["ops"].as_object().unwrap();
    assert_eq!(samples.len(), 26);
    for (name, sample) in samples {
        let op: Op = serde_json::from_value(sample.clone())
            .unwrap_or_else(|error| panic!("{name}: {error}; sample: {sample}"));
        let roundtrip = serde_json::to_value(op).unwrap();
        assert_preserved(sample, &roundtrip, name);
    }
    assert!(serde_json::from_value::<Op>(json!({"type":"unknown_probe"})).is_err());
    assert!(serde_json::from_value::<Op>(json!({"type":"enter_goal_mode"})).is_err());
}

#[test]
fn detector_rejects_silently_ignored_fields() {
    let typo = json!({"type":"enter_goal_mode", "goal":"goal", "token_buget":100});
    let op: Op = serde_json::from_value(typo.clone()).unwrap();
    let roundtrip = serde_json::to_value(op).unwrap();
    assert!(std::panic::catch_unwind(|| assert_preserved(&typo, &roundtrip, "probe")).is_err());
}
