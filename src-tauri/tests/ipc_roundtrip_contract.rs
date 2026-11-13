//! 能力覆盖层 · 持久化往返契约(真后端侧)。
//!
//! 跑的是与 `tests/ipc.roundtrip-contract.test.ts` **同一份**
//! `tests/contracts/roundtrips.json`:执行 `steps` 后 `load` 的结果必须满足
//! `expect`。两边都过,才能说模拟层与真后端在「写进去能怎样读回来」这个
//! 语义层面是一致的 —— 参数形状对齐(`ipc_payload_contract.rs`)只能保证
//! 「收得下」,保证不了「存得对」。

mod common;

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

#[derive(serde::Deserialize)]
struct Expectation {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    equals: Option<Value>,
    #[serde(default)]
    contains: Option<String>,
}

#[derive(serde::Deserialize)]
struct Roundtrip {
    name: String,
    steps: Vec<(String, Value)>,
    load: (String, Value),
    expect: Vec<Expectation>,
    /// load+expect 失败后的轮询窗口(毫秒;缺省 0 = 不轮询)。
    /// Op 类命令(`set_effort` / `set_permission_mode` …)经 submission loop
    /// **异步生效**,紧跟的读命令会与它竞态 —— 真后端侧需要轮询。
    #[serde(default)]
    poll_ms: u64,
}

#[derive(serde::Deserialize)]
struct Doc {
    roundtrips: Vec<Roundtrip>,
}

fn load_doc() -> Doc {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("contracts")
        .join("roundtrips.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读不到往返契约 {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("roundtrips.json 不是合法契约文档")
}

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

/// 点路径取值:`a.b.0.c`;空路径 = 整个值。
fn at<'a>(value: &'a Value, path: Option<&str>) -> Option<&'a Value> {
    let Some(path) = path else {
        return Some(value);
    };
    let mut cur = value;
    for seg in path.split('.') {
        cur = match cur {
            Value::Object(map) => map.get(seg)?,
            Value::Array(items) => items.get(seg.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// 本次运行的临时目录 —— macOS/Linux 取 canonical 路径,因为
/// `reflect_set_workspace` 读回的是规范化后的路径(macOS 的 `/var` 是
/// `/private/var` 的符号链接)。Windows 上**不能** canonicalize:
/// `std::fs::canonicalize` 会加 `\\?\` 长路径前缀,而带该前缀的路径会
/// 禁用 Win32 的分隔符归一化,契约参数 `${TMP}/xxx` 的斜杠拼接直接
/// 落在 os error 123(文件名语法不正确)。Windows 的 temp_dir 本就是
/// 绝对无符号链接路径,跳过规范化即可。
fn prepare_tmp() -> String {
    let dir =
        std::env::temp_dir().join(format!("reflect-desktop-roundtrip-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create roundtrip tmp dir");
    #[cfg(not(windows))]
    let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
    dir.display().to_string()
}

/// 对 `result` 逐条评估 `expect`,返回失败描述(空 = 全部成立)。
fn expectations_hold(rt: &Roundtrip, result: &Value, tmp: &str) -> Vec<String> {
    let load_cmd = &rt.load.0;
    let mut failures = Vec::new();
    for exp in &rt.expect {
        let got = at(result, exp.path.as_deref());
        let where_ = match &exp.path {
            Some(p) => format!("{load_cmd} @ {p}"),
            None => load_cmd.clone(),
        };
        if let Some(want) = &exp.equals {
            let want = expand_tmp(want, tmp);
            if got != Some(&want) {
                failures.push(format!(
                    "[{}] {where_} 应等于 {want},实际 {}",
                    rt.name,
                    got.map_or_else(|| "<缺失>".into(), |v| v.to_string())
                ));
            }
        }
        if let Some(needle) = &exp.contains {
            let hay = match got {
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            if !hay.contains(needle.as_str()) {
                failures.push(format!(
                    "[{}] {where_} 应包含 {needle:?},实际 {hay}",
                    rt.name
                ));
            }
        }
    }
    failures
}

#[test]
fn every_roundtrip_holds_on_the_real_backend() {
    let _ws = common::workspace_lock();
    let _st = common::state_lock();
    let tmp = prepare_tmp();
    let doc = load_doc();
    assert!(!doc.roundtrips.is_empty(), "往返契约表为空");

    let mut failures: Vec<String> = Vec::new();
    for rt in &doc.roundtrips {
        for (cmd, args) in &rt.steps {
            if let Err(e) = common::invoke(cmd, expand_tmp(args, &tmp)) {
                failures.push(format!("[{}] 步骤 {cmd} 失败: {e}", rt.name));
            }
        }
        // load+expect 整体按 `poll_ms` 轮询(Op 类命令异步生效,紧读会竞态)。
        let (load_cmd, load_args) = &rt.load;
        let deadline = std::time::Instant::now() + Duration::from_millis(rt.poll_ms);
        let load_args = expand_tmp(load_args, &tmp);
        let result = loop {
            let result = common::invoke(load_cmd, load_args.clone());
            let ok = result
                .as_ref()
                .is_ok_and(|v| expectations_hold(rt, v, &tmp).is_empty());
            if ok || std::time::Instant::now() >= deadline {
                break result;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let result = match result {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!("[{}] 读回 {load_cmd} 失败: {e}", rt.name));
                continue;
            }
        };
        failures.extend(expectations_hold(rt, &result, &tmp));
    }

    assert!(
        failures.is_empty(),
        "以下 {} 条往返契约在真后端上不成立:\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}
