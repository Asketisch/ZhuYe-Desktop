//! 能力覆盖层 · EventMsg 线格式契约(真后端侧)。
//!
//! `tests/contracts/events.json` 为协议 `EventMsg` 的**全部变体**各给出一份
//! 最小合法样本。同一份样本被三层消费:
//!
//! - L1 `tests/static/event-parity.mjs` —— Rust enum ↔ TS 类型联合 ↔ 样本表
//!   三方奇偶(新增/改名变体时点名缺谁);
//! - L2 `tests/ipc.event-contract.test.ts` —— 样本经真实事件 bus → reducer,
//!   不落 unknown 分支(前端能处理真后端发出的每一种事件);
//! - L3(本文件)—— **真协议 serde 必须能反序列化**样本,且判别子 roundtrip
//!   稳定。
//!
//! ## 为什么需要这一层
//!
//! reducer 对未知 `type` 是**安全降级**(空 patch),所以 submodule 升级新增
//! 事件后,前端测试会继续全绿、UI 静默吞掉新事件 —— 与 payload 契约
//! (`ipc_payload_contract.rs`)堵住的"参数形状漂移"镜像对称,这里堵的是
//! "事件形状漂移"。样本被三端同时喂,漂移无处可藏。
//!
//! ## 断言层级
//!
//! 事件没有命令面(不是请求,是后端写出口),所以本文件直接驱动协议 crate
//! 的 serde 层 —— 这正是引擎 `reflect_event` 通道发出的那条 wire 的权威
//! 定义点。子模块升级后如果事件结构变更(字段改名 / 必填新增),本文件
//! 会在编译期后的第一时间失败,并逐变体点名。

use std::collections::BTreeMap;

use reflect_protocol::EventMsg;
use serde_json::Value;

/// 注册表事件变体下限(当前 50)—— 新增变体由 L1 event-parity 三方奇偶
/// 精确守卫,这里只防样本表被意外清空 / 大规模回退。
const EVENT_COUNT_FLOOR: usize = 50;

fn load_event_contract() -> BTreeMap<String, Value> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("contracts")
        .join("events.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读不到事件契约样本 {}: {e}", path.display()));
    let doc: Value = serde_json::from_str(&raw).expect("events.json 不是合法 JSON");
    doc["events"]
        .as_object()
        .expect("events.json 缺少 events 对象")
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// 逐变体:真协议 serde 反序列化 + 判别子与样本 type 一致 + roundtrip 稳定。
#[test]
fn every_event_sample_deserializes_on_the_real_protocol() {
    let events = load_event_contract();
    assert!(
        events.len() >= EVENT_COUNT_FLOOR,
        "事件样本表只有 {} 条,低于下限 {EVENT_COUNT_FLOOR}",
        events.len()
    );

    let mut failures: Vec<String> = Vec::new();
    for (ty, sample) in &events {
        // 样本自身的判别子必须与键一致 —— 键是三端共享的锚。
        assert_eq!(
            sample["type"].as_str().unwrap_or_default(),
            ty,
            "样本 {ty} 的 type 字段与键不一致"
        );
        match serde_json::from_value::<EventMsg>(sample.clone()) {
            Ok(msg) => {
                // 判别子锚定 **wire**(重序列化后的 `type` 字段)—— 这才是
                // `reflect_event` 通道上消费者看到的形态。不用
                // `EventMsg::discriminant()`:上游该 match 与 serde tag 存在
                // 内部不一致(`AskUserInput` 的 discriminant 是 `"ask_user"`,
                // wire tag 是 `ask_user_input`),锚定 wire 才是协议真相。
                let wire_type = |m: &EventMsg| -> String {
                    serde_json::to_value(m)
                        .ok()
                        .and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_string))
                        .unwrap_or_default()
                };
                if wire_type(&msg) != *ty {
                    failures.push(format!(
                        "{ty} ← 反序列化后的 wire type 是 {:?},与样本键不符",
                        wire_type(&msg)
                    ));
                }
                // roundtrip:反序列化 → 再序列化 → 再反序列化仍成功且 wire
                // type 不变 —— 保证引擎侧 emit 出的 wire 与样本同构。
                let re = serde_json::to_value(&msg)
                    .unwrap_or_else(|e| panic!("{ty}: 再序列化失败: {e}"));
                match serde_json::from_value::<EventMsg>(re) {
                    Ok(again) => {
                        if wire_type(&again) != *ty {
                            failures.push(format!("{ty} ← roundtrip 后 wire type 漂移"));
                        }
                    }
                    Err(e) => failures.push(format!("{ty} ← roundtrip 反序列化失败: {e}")),
                }
            }
            Err(e) => failures.push(format!("{ty} ← {sample}\n      ↳ {e}")),
        }
    }

    assert!(
        failures.is_empty(),
        "以下 {} 条事件样本被真协议 serde 拒绝(事件结构或样本漂移了):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}

/// 探测器自检:未知 `type` 必须被 serde 拒绝 —— 否则上面的用例空转
/// (serde 变成宽松后,任何样本都会"通过")。
#[test]
fn unknown_event_type_is_rejected() {
    let bogus = serde_json::json!({ "type": "definitely_not_a_real_event_v1" });
    assert!(
        serde_json::from_value::<EventMsg>(bogus).is_err(),
        "未知事件 type 应被 serde 拒绝 —— serde 严格性失效,契约测试失去意义"
    );
}

/// 探测器自检(反向):必填字段缺失必须被拒 —— 这正是本层要抓的漂移形状
/// (历史上真实发生过:TokenUsage 的 cache_write_tokens 曾从无到有,
/// 反向场景是字段改名后旧样本"静默通过")。
#[test]
fn missing_required_field_is_rejected() {
    let mut incomplete = load_event_contract();
    let sample = incomplete
        .get_mut("turn_complete")
        .expect("turn_complete 样本");
    sample["usage"]
        .as_object_mut()
        .expect("usage 是对象")
        .remove("input_tokens");
    assert!(
        serde_json::from_value::<EventMsg>(sample.clone()).is_err(),
        "缺必填字段的事件样本应被 serde 拒绝"
    );
}
