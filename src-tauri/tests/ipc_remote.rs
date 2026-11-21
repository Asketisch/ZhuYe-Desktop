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

/// 写 stub ssh 并返回其路径。
///
/// 行为:首行发 session_configured(固定 uuid),之后每收到一行(即一条
/// Submission)回 turn_started → turn_complete → submission_closed。
///
/// Windows 没有 shebang 执行机制,直接写 bash 脚本 spawn 会报
/// os error 193(not a valid Win32 application)—— 三个 remote 用例在
/// windows CI 全红。改为把同语义的 Rust stub 源码写到临时目录,用
/// `rustc`(测试进程必然自带)编成真可执行文件;`OnceLock` 保证每个
/// 测试二进制进程只编一次。
fn write_stub_ssh() -> PathBuf {
    static STUB: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    STUB.get_or_init(compile_stub_ssh).clone()
}

/// stub ssh 的 Rust 源码(与原 bash 脚本同语义)。
const STUB_SSH_SRC: &str = r#"// stub ssh:按远端命令分支(serve 握手+回显 / --version 探测 / bootstrap 安装)
use std::io::{BufRead, Write};
fn emit(line: &str) {
    println!("{}", line);
    let _ = std::io::stdout().flush();
}
fn main() {
    let joined = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    if joined.contains("serve") {
        emit("{\"id\":\"\",\"msg\":{\"type\":\"session_configured\",\"session_id\":\"00000000-0000-4000-8000-0000000000aa\",\"model\":\"mock\",\"provider\":\"mock\",\"approval_policy\":\"auto\",\"sandbox_policy\":\"workspace_only\"}}");
        let stdin = std::io::stdin();
        for _line in stdin.lock().lines() {
            emit("{\"id\":\"stub\",\"msg\":{\"type\":\"turn_started\",\"turn_id\":\"00000000-0000-4000-8000-0000000000b1\"}}");
            emit("{\"id\":\"stub\",\"msg\":{\"type\":\"turn_complete\",\"turn_id\":\"00000000-0000-4000-8000-0000000000b1\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1,\"cached_tokens\":0},\"status\":\"success\"}}");
            emit("{\"id\":\"stub\",\"msg\":{\"type\":\"submission_closed\"}}");
        }
    } else if joined.contains("--version") {
        println!("zhuye 0.1.15 (stub)");
    } else if joined.contains("exec sh") {
        // bootstrap:桌面送安装脚本经 stdin,这里模拟装完的自验输出。
        use std::io::Read;
        let _ = std::io::stdin().read_to_string(&mut String::new());
        println!("zhuye 0.1.15 (installed by stub)");
    } else {
        eprintln!("stub: unknown remote command: {}", joined);
        std::process::exit(9);
    }
}
"#;

/// 编译 stub 可执行文件(每测试进程一次)。
fn compile_stub_ssh() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zhuye-remote-stub-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create stub dir");
    let src = dir.join("stub_ssh.rs");
    std::fs::write(&src, STUB_SSH_SRC).expect("write stub src");
    let out = dir.join(if cfg!(windows) {
        "stub-ssh.exe"
    } else {
        "stub-ssh"
    });
    let status = std::process::Command::new("rustc")
        .arg("-O") // 与原脚本无差别的行为保真;优化让 serve 循环更跟手
        .arg("--edition")
        .arg("2021")
        .arg(&src)
        .arg("-o")
        .arg(&out)
        .status()
        .expect("rustc 不在 PATH(测试进程必带);无法编译 stub ssh");
    assert!(status.success(), "stub ssh 编译失败:{status}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    out
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
        let file = zhuye_config::paths::data_path(&["remote-hosts.json"]);
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
            zhuye_config::paths::data_path(&["remote-hosts.json"]),
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
    let empty = invoke_ok("zhuye_remote_hosts", json!({}));
    assert!(empty.as_array().unwrap().is_empty(), "{empty}");

    // 新增 → 读回(name 键幂等覆盖)。
    invoke_ok(
        "zhuye_remote_host_save",
        json!({ "name": "build-box", "host": "10.0.0.5", "port": 2222, "user": "me" }),
    );
    invoke_ok(
        "zhuye_remote_host_save",
        json!({ "name": "build-box", "host": "10.0.0.6" }),
    );
    let hosts = invoke_ok("zhuye_remote_hosts", json!({}));
    let arr = hosts.as_array().unwrap();
    assert_eq!(arr.len(), 1, "同名覆盖不新增: {hosts}");
    assert_eq!(arr[0]["host"], "10.0.0.6", "{hosts}");
    assert_eq!(arr[0]["port"], 22, "缺省端口落 22: {hosts}");
    assert!(arr[0]["user"].is_null(), "空 user 不出线: {hosts}");

    // 删除。
    let after = invoke_ok("zhuye_remote_host_remove", json!({ "name": "build-box" }));
    assert!(after.as_array().unwrap().is_empty(), "{after}");
}

#[test]
fn remote_connect_handshake_and_pump_flow() {
    // 先在纯同步上下文预热进程级夹具:Runtime::new 在 async 上下文内
    // 会 panic(详见 common::warmup 文档)。
    common::warmup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);

        // 注册 host + 连接(握手:stub 首行 session_configured)。
        invoke_ok(
            "zhuye_remote_host_save",
            json!({ "name": "stub-box", "host": "stub" }),
        );
        let sid = invoke_ok(
            "zhuye_remote_connect",
            json!({ "host": "stub-box", "cwd": "/home/me/proj" }),
        );
        let sid = sid.as_str().expect("连接返回 sid").to_string();
        assert_eq!(
            sid, "00000000-0000-4000-8000-0000000000aa",
            "sid 来自 stub 握手: {sid}"
        );

        // 活跃会话列表:连接可见。
        let sessions = invoke_ok("zhuye_remote_sessions", json!({}));
        let arr = sessions.as_array().unwrap();
        assert_eq!(arr.len(), 1, "{sessions}");
        assert_eq!(arr[0]["sid"], sid.as_str(), "{sessions}");
        assert_eq!(arr[0]["cwd"], "/home/me/proj", "{sessions}");

        // bind → 前台插槽置位(is_foreground)。
        invoke_ok("zhuye_remote_bind", json!({ "sid": sid }));
        let sessions = invoke_ok("zhuye_remote_sessions", json!({}));
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
        let result = invoke("zhuye_submit", submission);
        // fake 模型未安装的本地路径不会走到;前台远程路由在 thread 检查**之前**,
        // 因此即便本地 AgentThread 缺位也应成功投递远端。
        assert!(result.is_ok(), "远程前台提交应成功: {result:?}");

        // 断开 → 会话摘除 + 前台插槽清空。
        invoke_ok("zhuye_remote_disconnect", json!({ "sid": sid }));
        let sessions = invoke_ok("zhuye_remote_sessions", json!({}));
        assert!(sessions.as_array().unwrap().is_empty(), "{sessions}");
        let bind_err = invoke("zhuye_remote_bind", json!({ "sid": sid }));
        assert!(bind_err.is_err(), "断开后 bind 应报错: {bind_err:?}");
    });
}

#[test]
fn remote_connect_fails_for_unknown_host_and_bad_handshake() {
    // 先在纯同步上下文预热进程级夹具:Runtime::new 在 async 上下文内
    // 会 panic(详见 common::warmup 文档)。
    common::warmup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let _ssh = SshBinGuard::set(&std::path::PathBuf::from("/bin/false"));

        // 未知 host。
        let err = invoke(
            "zhuye_remote_connect",
            json!({ "host": "nope", "cwd": "/tmp" }),
        );
        assert!(err.is_err(), "{err:?}");
        assert!(
            err.unwrap_err().to_string().contains("不存在"),
            "错误应说明 host 不存在"
        );

        // 已注册但握手失败(/bin/false 即退,无输出)。
        invoke_ok(
            "zhuye_remote_host_save",
            json!({ "name": "dead-box", "host": "dead" }),
        );
        let err = invoke(
            "zhuye_remote_connect",
            json!({ "host": "dead-box", "cwd": "/tmp" }),
        );
        assert!(err.is_err(), "{err:?}");
    });
}

#[test]
fn remote_bootstrap_installs_and_reports_version() {
    // 先在纯同步上下文预热进程级夹具:Runtime::new 在 async 上下文内
    // 会 panic(详见 common::warmup 文档)。
    common::warmup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let _hosts = HostsGuard::take();
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);

        invoke_ok(
            "zhuye_remote_host_save",
            json!({ "name": "fresh-box", "host": "fresh" }),
        );
        // bootstrap 命令走 stub 的 "exec sh" 分支:返回安装自验版本行。
        let out = invoke_ok("zhuye_remote_bootstrap", json!({ "host": "fresh-box" }));
        assert_eq!(
            out.as_str().unwrap(),
            "zhuye 0.1.15 (installed by stub)",
            "{out}"
        );

        // 未知 host → 结构化错误。
        let err = invoke("zhuye_remote_bootstrap", json!({ "host": "nope" }));
        assert!(err.is_err(), "{err:?}");
        assert!(err.unwrap_err().to_string().contains("不存在"));
    });
}

#[test]
fn remote_bind_rejects_unknown_sid() {
    // 先在纯同步上下文预热进程级夹具:Runtime::new 在 async 上下文内
    // 会 panic(详见 common::warmup 文档)。
    common::warmup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        let err = invoke(
            "zhuye_remote_bind",
            json!({ "sid": "00000000-0000-4000-8000-999999999999" }),
        );
        assert!(err.is_err(), "{err:?}");
    });
}

#[test]
fn remote_test_probe_surfaces_cli_version_or_guidance() {
    // 先在纯同步上下文预热进程级夹具:Runtime::new 在 async 上下文内
    // 会 panic(详见 common::warmup 文档)。
    common::warmup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let _lock = state_lock();
        // stub:可执行且输出版本行。
        let stub = write_stub_ssh();
        let _ssh = SshBinGuard::set(&stub);
        let out = invoke_ok("zhuye_remote_test", json!({ "host": "stub", "port": 22 }));
        // stub 不实现 --version 分支(输出为空也成功)—— 命令面只断言结构。
        assert!(out.is_string(), "{out}");
    });
}
