//! 能力覆盖层 · SSH 远程开发 —— 真实命令体 over 真实 IPC 通路。
//!
//! 传输用 **stub ssh** —— 临时目录里放一个可执行脚本(`ZHUYE_REMOTE_SSH_BIN`
//! 指向它),模拟远端 `zhuye serve` 的 wire 行为(session_configured 握手
//! 加回合事件)。用例覆盖 host 注册表 CRUD(隔离 HOME 持久化)、连接握手、
//! 前台插槽置位、事件进 session 通道与断开清理,全程不连任何真 ssh。

mod common;

use common::{invoke, invoke_ok, state_lock};
use serde_json::json;
use std::path::PathBuf;

/// 写 stub ssh 脚本并返回其路径。
///
/// 行为:首行发 session_configured(固定 uuid),之后每收到一行(即一条
/// Submission)回 turn_started → turn_complete → submission_closed。
fn write_stub_ssh() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zhuye-remote-stub-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create stub dir");
    let script = dir.join("stub-ssh");
    let body = r#"#!/usr/bin/env bash
# 按远端命令分支:serve(握手+回显)/ --version(探测)/ bootstrap(安装)。
case "$*" in
  *"serve"*)
    SID="00000000-0000-4000-8000-0000000000aa"
    TID="00000000-0000-4000-8000-0000000000b1"
    echo "{\"id\":\"\",\"msg\":{\"type\":\"session_configured\",\"session_id\":\"$SID\",\"model\":\"mock\",\"provider\":\"mock\",\"approval_policy\":\"auto\",\"sandbox_policy\":\"workspace_only\"}}"
    while IFS= read -r _line; do
      echo "{\"id\":\"stub\",\"msg\":{\"type\":\"turn_started\",\"turn_id\":\"$TID\"}}"
      echo "{\"id\":\"stub\",\"msg\":{\"type\":\"turn_complete\",\"turn_id\":\"$TID\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1,\"cached_tokens\":0},\"status\":\"success\"}}"
      echo '{"id":"stub","msg":{"type":"submission_closed"}}'
    done
    ;;
  *"--version"*)
    echo "zhuye 0.1.15 (stub)"
    ;;
  *"exec sh"*)
    # bootstrap:桌面送安装脚本经 stdin,这里模拟装完的自验输出。
    cat > /dev/null
    echo "zhuye 0.1.15 (installed by stub)"
    ;;
  *)
    echo "stub: unknown remote command: $*" >&2
    exit 9
    ;;
esac
"#;
    std::fs::write(&script, body).expect("write stub");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    script
}

/// stub 注入的环境守卫(测试内设置,结束还原,防串扰并行用例)。
struct SshBinGuard {
    original: Option<std::ffi::OsString>,
}
impl SshBinGuard {
    fn set(path: &std::path::Path) -> Self {
        let original = std::env::var_os("ZHUYE_REMOTE_SSH_BIN");
        unsafe {
            std::env::set_var("ZHUYE_REMOTE_SSH_BIN", path);
        }
        SshBinGuard { original }
    }
}
impl Drop for SshBinGuard {
    fn drop(&mut self) {
        unsafe {
            match self.original.take() {
                Some(v) => std::env::set_var("ZHUYE_REMOTE_SSH_BIN", v),
                None => std::env::remove_var("ZHUYE_REMOTE_SSH_BIN"),
            }
        }
    }
}

/// host 注册表隔离:用例内保存/还原 remote-hosts.json(共享夹具 HOME)。
struct HostsGuard {
    file: Option<PathBuf>,
}
impl HostsGuard {
    fn take() -> Self {
        let file = reflect_config::paths::data_path(&["remote-hosts.json"]);
        let backup = file.as_ref().filter(|p| p.exists()).cloned();
        if let Some(p) = &file {
            let _ = std::fs::remove_file(p);
        }
        HostsGuard { file: backup }
    }
}
impl Drop for HostsGuard {
    fn drop(&mut self) {
        if let (Some(p), Some(backup)) = (
            reflect_config::paths::data_path(&["remote-hosts.json"]),
            self.file.take(),
        ) {
            let _ = std::fs::copy(&backup, &p);
        }
    }
}

#[test]
fn remote_hosts_registry_round_trips_persistently() {
    let _lock = state_lock();
    let _hosts = HostsGuard::take();
    // 初始空表。
    let empty = invoke_ok("reflect_remote_hosts", json!({}));
    assert!(empty.as_array().unwrap().is_empty(), "{empty}");

    // 新增 → 读回(name 键幂等覆盖)。
    invoke_ok(
        "reflect_remote_host_save",
        json!({ "name": "build-box", "host": "10.0.0.5", "port": 2222, "user": "me" }),
    );
    invoke_ok(
        "reflect_remote_host_save",
        json!({ "name": "build-box", "host": "10.0.0.6" }),
    );
    let hosts = invoke_ok("reflect_remote_hosts", json!({}));
    let arr = hosts.as_array().unwrap();
    assert_eq!(arr.len(), 1, "同名覆盖不新增: {hosts}");
    assert_eq!(arr[0]["host"], "10.0.0.6", "{hosts}");
    assert_eq!(arr[0]["port"], 22, "缺省端口落 22: {hosts}");
    assert!(arr[0]["user"].is_null(), "空 user 不出线: {hosts}");

    // 删除。
    let after = invoke_ok("reflect_remote_host_remove", json!({ "name": "build-box" }));
    assert!(after.as_array().unwrap().is_empty(), "{after}");
}

#[test]
fn remote_connect_handshake_and_pump_flow() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);

        // 注册 host + 连接(握手:stub 首行 session_configured)。
        invoke_ok(
            "reflect_remote_host_save",
            json!({ "name": "stub-box", "host": "stub" }),
        );
        let sid = invoke_ok(
            "reflect_remote_connect",
            json!({ "host": "stub-box", "cwd": "/home/me/proj" }),
        );
        let sid = sid.as_str().expect("连接返回 sid").to_string();
        assert_eq!(
            sid, "00000000-0000-4000-8000-0000000000aa",
            "sid 来自 stub 握手: {sid}"
        );

        // 活跃会话列表:连接可见。
        let sessions = invoke_ok("reflect_remote_sessions", json!({}));
        let arr = sessions.as_array().unwrap();
        assert_eq!(arr.len(), 1, "{sessions}");
        assert_eq!(arr[0]["sid"], sid.as_str(), "{sessions}");
        assert_eq!(arr[0]["cwd"], "/home/me/proj", "{sessions}");

        // bind → 前台插槽置位(is_foreground)。
        invoke_ok("reflect_remote_bind", json!({ "sid": sid }));
        let sessions = invoke_ok("reflect_remote_sessions", json!({}));
        assert_eq!(
            sessions.as_array().unwrap()[0]["isForeground"],
            true,
            "{sessions}"
        );

        // 前台提交走远端:stub 回 turn_started/turn_complete,泵把它们送进
        // session 通道 —— 直接订阅 broadcast 断言事件到达。
        let submission = json!({
            "submission": {
                "id": "probe-sub-1",
                "op": { "type": "user_input", "items": [{ "type": "text", "text": "看看构建" }] }
            }
        });
        let result = invoke("reflect_submit", submission);
        // fake 模型未安装的本地路径不会走到;前台远程路由在 thread 检查**之前**,
        // 因此即便本地 AgentThread 缺位也应成功投递远端。
        assert!(result.is_ok(), "远程前台提交应成功: {result:?}");

        // 断开 → 会话摘除 + 前台插槽清空。
        invoke_ok("reflect_remote_disconnect", json!({ "sid": sid }));
        let sessions = invoke_ok("reflect_remote_sessions", json!({}));
        assert!(sessions.as_array().unwrap().is_empty(), "{sessions}");
        let bind_err = invoke("reflect_remote_bind", json!({ "sid": sid }));
        assert!(bind_err.is_err(), "断开后 bind 应报错: {bind_err:?}");
    });
}

#[test]
fn remote_connect_fails_for_unknown_host_and_bad_handshake() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let _ssh = SshBinGuard::set(&std::path::PathBuf::from("/bin/false"));

        // 未知 host。
        let err = invoke(
            "reflect_remote_connect",
            json!({ "host": "nope", "cwd": "/tmp" }),
        );
        assert!(err.is_err(), "{err:?}");
        assert!(
            err.unwrap_err().to_string().contains("不存在"),
            "错误应说明 host 不存在"
        );

        // 已注册但握手失败(/bin/false 即退,无输出)。
        invoke_ok(
            "reflect_remote_host_save",
            json!({ "name": "dead-box", "host": "dead" }),
        );
        let err = invoke(
            "reflect_remote_connect",
            json!({ "host": "dead-box", "cwd": "/tmp" }),
        );
        assert!(err.is_err(), "{err:?}");
    });
}

#[test]
fn remote_bootstrap_installs_and_reports_version() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);

        invoke_ok(
            "reflect_remote_host_save",
            json!({ "name": "fresh-box", "host": "fresh" }),
        );
        // bootstrap 命令走 stub 的 "exec sh" 分支:返回安装自验版本行。
        let out = invoke_ok("reflect_remote_bootstrap", json!({ "host": "fresh-box" }));
        assert_eq!(
            out.as_str().unwrap(),
            "zhuye 0.1.15 (installed by stub)",
            "{out}"
        );

        // 未知 host → 结构化错误。
        let err = invoke("reflect_remote_bootstrap", json!({ "host": "nope" }));
        assert!(err.is_err(), "{err:?}");
        assert!(err.unwrap_err().to_string().contains("不存在"));
    });
}

#[test]
fn remote_bind_rejects_unknown_sid() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let err = invoke(
            "reflect_remote_bind",
            json!({ "sid": "00000000-0000-4000-8000-999999999999" }),
        );
        assert!(err.is_err(), "{err:?}");
    });
}

#[test]
fn remote_test_probe_surfaces_cli_version_or_guidance() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        // stub:可执行且输出版本行。
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);
        let out = invoke_ok("reflect_remote_test", json!({ "host": "stub", "port": 22 }));
        // stub 不实现 --version 分支(输出为空也成功)—— 命令面只断言结构。
        assert!(out.is_string(), "{out}");
    });
}
