//! 能力覆盖夹具不得继承覆盖数据路径或真实 provider 的宿主环境。
mod common;

use std::process::Command;

#[test]
fn isolation_probe_child() {
    if std::env::var_os("REFLECT_ISOLATION_PROBE").is_none() {
        return;
    }
    common::init_isolated_env();
    for key in [
        "ZHUYE_HOME",
        "ZHUYE_HUMAN_INPUT_DIR",
        "ZHUYE_ROLLOUT_BASE",
        "ZHUYE_QUOTA_STATE",
        "ZHUYE_SESSION_ID",
        "ZHUYE_SANDBOX_WRITABLE",
        "ZHUYE_MODEL",
        "ZHUYE_PROVIDER",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OLLAMA_HOST",
    ] {
        assert!(
            std::env::var_os(key).is_none(),
            "{key} escaped the test sandbox"
        );
    }
    let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    let data = reflect_config::paths::data_dir().unwrap();
    assert_eq!(data, home.join(".zhuye"));
    let store = reflect_tools::HumanInputStore::from_env_or_default().unwrap();
    store.write_pending("sandbox-probe", "synthetic prompt");
    assert!(data.join("human_input/sandbox-probe.json").exists());
    reflect_llm::QuotaTracker::new().save_state_if_configured();
    assert!(data.join("quota-state.json").exists());
}

#[test]
fn inherited_external_paths_cannot_receive_test_data() {
    let temp = tempfile::tempdir().unwrap();
    let outside = temp.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("sentinel"), "unchanged").unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "isolation_probe_child", "--nocapture"])
        .env("REFLECT_ISOLATION_PROBE", "1")
        .env("REFLECT_TEST_HOME", temp.path().join("isolated"))
        .env("ZHUYE_HOME", &outside)
        .env("ZHUYE_HUMAN_INPUT_DIR", &outside)
        .env("ZHUYE_ROLLOUT_BASE", &outside)
        .env("ZHUYE_QUOTA_STATE", outside.join("quota.json"))
        .env("ZHUYE_SESSION_ID", "host-session")
        .env("ZHUYE_SANDBOX_WRITABLE", &outside)
        .env("ZHUYE_MODEL", "host-provider/host-model")
        .env("ZHUYE_PROVIDER", "host-provider")
        .env("OPENAI_API_KEY", "synthetic-key")
        .env("ANTHROPIC_API_KEY", "synthetic-key")
        .env("OLLAMA_HOST", "http://127.0.0.1:9")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "isolation child failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(outside.join("sentinel")).unwrap(),
        "unchanged"
    );
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 1);
}

#[test]
fn stale_pid_directory_probe_child() {
    if std::env::var_os("REFLECT_STALE_PID_PROBE").is_none() {
        return;
    }
    let old_base =
        std::env::temp_dir().join(format!("reflect-desktop-capability-{}", std::process::id()));
    let old_data = old_base.join("home/.zhuye");
    std::fs::create_dir_all(&old_data).unwrap();
    std::fs::write(old_data.join("config.toml"), "stale_config_marker = true\n").unwrap();
    common::init_isolated_env();
    let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    assert_ne!(home, old_base.join("home"), "旧进程目录不能复用");
    assert!(
        !std::fs::read_to_string(home.join(".zhuye/config.toml"))
            .unwrap()
            .contains("stale_config_marker")
    );
}

#[test]
fn stale_pid_directory_is_not_reused() {
    let temp = tempfile::tempdir().unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "stale_pid_directory_probe_child", "--nocapture"])
        .env("REFLECT_STALE_PID_PROBE", "1")
        .env_remove("REFLECT_TEST_HOME")
        .env("TMPDIR", temp.path())
        .env("TMP", temp.path())
        .env("TEMP", temp.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "stale PID isolation child failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
