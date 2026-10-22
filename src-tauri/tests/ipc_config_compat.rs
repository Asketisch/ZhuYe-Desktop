//! 能力覆盖层 · 配置向前/向后兼容 —— 旧配置文件在**新进程启动**时必须可用。
//!
//! 场景:用户升级应用,`~/.reflect/config.toml` 还是旧版本写的(或被手工
//! 编辑过),新进程启动时读它。夹具(`tests/fixtures/config/`)覆盖四种
//! 形态:最小 / 旧版本全量 / 未知键(前向兼容)/ 当前全量。
//!
//! 为什么走子进程:`reflect_get_config` 读的是**内存快照**,桌面端没有把
//! ConfigWatcher 接到该快照 —— 进程内直接写文件不会热重载(实测如此)。
//! 「旧文件 + 新进程」(= 升级)只能用 `ipc_restart.rs` 同款子进程重执行
//! 复刻:父进程为每个夹具准备独立 HOME 并预置配置文件,子进程以该 HOME
//! 全新构建 app,断言已知键生效、未知键不致命、agent 存活。

mod common;

use std::path::PathBuf;

use serde_json::json;

const FIXTURE_ENV: &str = "REFLECT_COMPAT_FIXTURE";
const HOME_ENV: &str = "REFLECT_TEST_HOME";
const TEST_NAME: &str = "legacy_and_unknown_config_shapes_load_in_a_fresh_process";

/// (文件名, 应在规范化读回配置中出现的标记 —— 全部是「已知键」的值,
/// 未知键会被规范化丢弃,不能当标记)。
const FIXTURES: &[(&str, &str)] = &[
    ("minimal.toml", "[hooks]"),
    ("legacy-v0.toml", "claude-3-5-sonnet-latest"),
    ("unknown-keys.toml", "sk-ant-future"),
    ("full.toml", "claude-sonnet-4-5"),
];

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("config")
        .join(name)
}

/// 子进程:以预置了 fixture 配置的 HOME 全新启动 app 并断言。
fn run_fixture(name: &str, marker: &str) {
    drop(common::harness()); // 读入预置的 fixture 配置(仅当文件缺失才写默认)

    // 已知键生效:标记出现在规范化读回配置里。
    let cfg = common::invoke_ok("reflect_get_config", json!({}));
    let text = cfg.as_str().unwrap_or_default().to_string();
    assert!(
        text.contains(marker),
        "[{name}] 已知键未生效:标记 {marker} 不在读回配置中:\n{text}"
    );

    // 读回值是合法且已规范化的 TOML(未知键被丢弃不致命)。
    let parsed: toml::Value = toml::from_str(&text)
        .unwrap_or_else(|e| panic!("[{name}] 读回配置不是合法 TOML:\n{text}\n{e}"));
    assert!(
        parsed.get("hooks").is_some(),
        "[{name}] 规范化后丢失 hooks 段:\n{text}"
    );

    // agent 存活:状态可读、提交仍被受理。
    let status = common::invoke_ok("reflect_agent_status", json!({}));
    assert!(status.is_object(), "[{name}] agent_status 异常: {status}");
    let submitted = common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": {
                "id": format!("config-compat-{name}"),
                "op": { "type": "user_input", "items": [{ "type": "text", "text": "配置兼容探针" }] },
            }
        }),
    );
    assert!(
        submitted.is_string(),
        "[{name}] submit 未被受理: {submitted}"
    );
}

#[test]
fn legacy_and_unknown_config_shapes_load_in_a_fresh_process() {
    if let Ok(name) = std::env::var(FIXTURE_ENV) {
        let marker = FIXTURES
            .iter()
            .find(|(n, _)| n == &name)
            .map(|(_, m)| *m)
            .unwrap_or_else(|| panic!("未知 fixture: {name}"));
        run_fixture(&name, marker);
        return;
    }

    // 父进程:每个夹具一个独立 HOME,预置配置文件后起子进程。
    for (name, _) in FIXTURES {
        let shared = std::env::temp_dir().join(format!(
            "reflect-desktop-config-compat-{}-{name}",
            std::process::id()
        ));
        let reflect = shared.join("home").join(".reflect");
        std::fs::create_dir_all(&reflect).expect("创建夹具 HOME");
        std::fs::create_dir_all(shared.join("home").join("workspace")).expect("创建夹具 workspace");
        let raw = std::fs::read_to_string(fixture_path(name))
            .unwrap_or_else(|e| panic!("读不到 fixture {name}: {e}"));
        std::fs::write(reflect.join("config.toml"), raw).expect("预置 fixture 配置");

        let exe = std::env::current_exe().expect("定位测试二进制");
        let status = std::process::Command::new(exe)
            .arg("--exact")
            .arg(TEST_NAME)
            .arg("--nocapture")
            .env(FIXTURE_ENV, name)
            .env(HOME_ENV, &shared)
            .status()
            .unwrap_or_else(|e| panic!("spawn fixture 子进程 {name}: {e}"));
        assert!(
            status.success(),
            "fixture {name} 在新进程加载失败:{status:?}"
        );
    }
}
