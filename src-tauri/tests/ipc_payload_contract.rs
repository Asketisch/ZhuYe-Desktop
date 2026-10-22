//! 能力覆盖层 · 跨运行时线格式契约(真后端侧)。
//!
//! `tests/contracts/payloads.json` 为每条注册命令给出一份参数样本。同一份
//! 样本被三层消费:
//!
//! - L1 `tests/static/analyze.mjs` —— 注册表里每条命令都必须有样本;
//! - L2 `tests/ipc.payload-contract.test.ts` —— `fakeBackend` 必须接受样本;
//! - L3(本文件)—— **真后端必须能反序列化**样本。
//!
//! ## 为什么需要这一层
//!
//! L2 的全部前端测试都跑在 `fakeBackend` 上。模拟层一旦与真后端的参数形状
//! 走样(历史实例:`reflect_save_allowlist` 的 `entries` vs 真后端的
//! `prefixes`),前端测试会继续全绿,而线上调用会被 Tauri 以
//! `invalid args` 拒绝。把同一份样本同时喂给两边,漂移就无处可藏。
//!
//! ## 断言口径
//!
//! 只盯**反序列化**:命令可以因为业务原因返回结构化错误(会话不存在、
//! 路径不是 git 仓库、网络不可达……),但不能返回 Tauri 的参数反序列化
//! 错误(`invalid args` / `missing field` / `unknown field` / `invalid type`)。
//! 命令未注册时 `common::invoke` 会以超时 panic —— 这同时抓住了「样本里
//! 还留着已删除命令」。

mod common;

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{Value, json};

/// 1×1 像素的合法 PNG —— `reflect_image_process` / `reflect_read_image_base64`
/// 样本指向它。
const PROBE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

fn contracts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("contracts")
}

/// 样本表 + 真后端侧跳过清单。
///
/// 跳过清单放在契约文件里而不是写成本文件的字面量:它与
/// `tests/COVERAGE.md` §3 的显式排除项同源,而且 L1 的
/// `capability-command-coverage` 棘轮是按 `ipc_*.rs` 里出现的命令名字符串
/// 计数的 —— 在这里写出那 6 个名字会把「没驱动」误记成「已覆盖」。
struct Contract {
    skip_on_real_backend: Vec<String>,
    commands: BTreeMap<String, Value>,
}

fn load_contract() -> Contract {
    let path = contracts_dir().join("payloads.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读不到契约样本 {}: {e}", path.display()));
    let doc: Value = serde_json::from_str(&raw).expect("payloads.json 不是合法 JSON");
    let skip_on_real_backend = doc["skipOnRealBackend"]
        .as_array()
        .expect("payloads.json 缺少 skipOnRealBackend 数组")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    let commands = doc["commands"]
        .as_object()
        .expect("payloads.json 缺少 commands 对象")
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Contract {
        skip_on_real_backend,
        commands,
    }
}

/// 递归把字符串里的 `${TMP}` 换成本次运行的临时目录。
fn expand_tmp(v: &Value, tmp: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace("${TMP}", tmp)),
        Value::Array(items) => Value::Array(items.iter().map(|x| expand_tmp(x, tmp)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, x)| (k.clone(), expand_tmp(x, tmp)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Tauri 参数反序列化失败的特征 —— 与业务错误区分开。
fn is_deserialization_error(err: &Value) -> bool {
    let text = match err {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    text.contains("invalid args")
        || text.contains("missing field")
        || text.contains("unknown field")
        || text.contains("invalid type")
        || text.contains("unknown variant")
}

/// 建本次运行的临时目录并放好样本引用的文件。
fn prepare_tmp() -> String {
    let dir = std::env::temp_dir().join(format!("reflect-desktop-contract-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create contract tmp dir");
    std::fs::write(dir.join("contract-probe.txt"), "hello contract\n").expect("write probe txt");
    std::fs::write(dir.join("contract-probe.png"), PROBE_PNG).expect("write probe png");
    dir.display().to_string()
}

#[test]
fn every_payload_sample_deserializes_on_the_real_backend() {
    // 样本里有切工作区、改配置的命令 —— 两把锁都持有,避免与同二进制内
    // 其它用例交叉。
    let _ws = common::workspace_lock();
    let _st = common::state_lock();
    let tmp = prepare_tmp();

    let contract = load_contract();
    let payloads = &contract.commands;
    let skip = &contract.skip_on_real_backend;
    assert!(
        payloads.len() >= 185,
        "样本表只有 {} 条,少于注册表规模",
        payloads.len()
    );
    assert!(
        skip.iter().all(|c| payloads.contains_key(c)),
        "skipOnRealBackend 里有不在样本表中的命令: {skip:?}"
    );

    // `reflect_shutdown` 会关掉 AgentThread —— 必须最后跑,否则后面的命令
    // 会因为「agent 已关闭」失败,把反序列化检查的信号盖掉。
    let mut ordered: Vec<(&String, &Value)> = payloads
        .iter()
        .filter(|(cmd, _)| cmd.as_str() != "reflect_shutdown")
        .collect();
    if let Some(shutdown) = payloads.get_key_value("reflect_shutdown") {
        ordered.push(shutdown);
    }

    let mut failures: Vec<String> = Vec::new();
    let mut driven = 0usize;
    for (cmd, args) in ordered {
        if skip.contains(cmd) {
            continue;
        }
        let args = expand_tmp(args, &tmp);
        driven += 1;
        if let Err(e) = common::invoke(cmd, args.clone()) {
            if is_deserialization_error(&e) {
                failures.push(format!("{cmd} ← {args}\n      ↳ {e}"));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "以下 {} 条样本被真后端以参数反序列化错误拒绝(样本或命令签名漂移了):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
    assert_eq!(driven, payloads.len() - skip.len(), "投喂数量与样本表不符");
}

/// 探测器自检:历史上真实发生过的漂移形状(`entries` 而非 `prefixes`)
/// 必须被识别为反序列化错误 —— 否则上面的用例是空转。
#[test]
fn the_detector_recognizes_the_historical_allowlist_drift() {
    let e = common::invoke_err(
        "reflect_save_allowlist",
        json!({ "list": { "entries": ["git status"] } }),
    );
    assert!(
        is_deserialization_error(&e),
        "错误形状的 allowlist 样本应被识别为反序列化错误,实际: {e}"
    );
}

/// 探测器自检(反向):业务错误**不能**被误判为反序列化错误。
#[test]
fn the_detector_ignores_business_errors() {
    let e = common::invoke_err(
        "reflect_get_trace",
        json!({ "id": "no-such-trace-for-contract-check" }),
    );
    assert!(
        !is_deserialization_error(&e),
        "不存在的 trace 应是业务错误,却被判为反序列化错误: {e}"
    );
}
