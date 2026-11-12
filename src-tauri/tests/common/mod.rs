//! 能力覆盖层夹具 —— 驱动**真实**命令体,不经前端 invoke 包装。
//!
//! ## 为什么要有这一层
//!
//! 前端测试(`tests/*.test.tsx`)的后端是**模拟**的:`tests/helpers/fakeBackend.ts`
//! 实现了全部 IPC 命令。模拟后端的 bug 会把真后端的 bug 遮住 —— 与
//! submodule「能力覆盖层不经过任何 SDK」的道理同源。
//!
//! 这一层直接对**生产同一份** `generate_handler!` 注册表
//! (`reflect_desktop_lib::configure`)注入 JSON 负载,断言真命令体返回的
//! 真结果。没有前端包装、没有 fakeBackend、没有 SDK 中间层。
//!
//! ## 隔离
//!
//! 每个测试二进制(=每个测试文件)启动时把 `HOME` 指向
//! 一个临时目录 —— 真后端读写 `~/.zhuye/*`,不隔离就会污染开发者的
//! 真实会话、记忆与任务。只设 `HOME` 即可:核心 crate 的数据根是
//! `$ZHUYE_HOME` > `$HOME/.zhuye`。同时清除人工输入、回滚、配额等
//! 独立路径覆盖以及 provider 凭证，避免绕过隔离目录或连接真实服务。
//!
//! ## 生命周期
//!
//! 整个测试二进制**共用一个 app**:与生产一致(一个进程一个 app),
//! 且 `install_agent_thread` 只跑一次。该调用内部 `tokio::spawn` 了
//! AgentThread 的 submission loop —— 若跑在某个用例的临时 runtime 上,
//! 用例一结束 loop 就没了。因此夹具持有**一个进程级 tokio runtime**
//! 并在 install 期间 `enter()` 它,让 loop 活到进程退出。
#![allow(dead_code)]

use std::sync::{Mutex, MutexGuard, Once, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeError, InvokeResponse, OwnedInvokeResponder};
use tauri::test::{INVOKE_KEY, MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};

use reflect_desktop_lib::state::MinimalAgent;

/// 单条命令的墙钟预算。超时不当"卡死"处理,而是让**这一条**失败。
/// 30s 对 mock 模型绰绰有余;但实模型演练层(L6)的同步命令会在命令体
/// 内联跑完整条 LLM 链(如 `reflect_run_team_pipeline` = 4 个节点逐个
/// 调模型)—— 思考型模型下单节点就可能超过 30s,窗口必须给足(2026-11
/// 局域网网关实测:team-pipeline 在 30s 窗口下间歇性超时)。
const COMMAND_TIMEOUT: Duration = Duration::from_secs(180);

static HARNESS: OnceLock<Mutex<Harness>> = OnceLock::new();
static ENV_INIT: Once = Once::new();
static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static WORKSPACE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CONFIG_OVERRIDE: OnceLock<String> = OnceLock::new();

/// 能力覆盖层的共享夹具。
///
/// 包在 `Mutex` 里有两个原因:
///   1. `MockRuntime` 只 `Send` 不 `Sync` —— 静态共享必须经互斥;
///   2. 一次只跑一条 IPC,行为确定,不会两条命令交叉改状态。
pub struct Harness {
    /// mock app —— 取托管状态用。
    pub app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
}

/// 进程级 tokio runtime —— 让 AgentThread 的 submission loop 活到进程退出。
fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("build harness tokio runtime")
    })
}

/// 在**首次** [`harness()`] 之前覆盖隔离环境的 `config.toml` 内容。
///
/// AgentThread 在安装时(`install_agent_thread`)就从配置构建
/// ModelRegistry —— provider / api_key / base_url 必须在那一刻就位。
/// 默认写最小配置(关掉全部内置 hook);需要特定 provider 配置的测试
/// 二进制(如 `ipc_mock_provider.rs` 的本地 mock LLM 服务)先调本函数再
/// 触发 `harness()`。首次调用后设置不再生效(OnceLock 语义,静默忽略)。
pub fn set_config_before_install(toml: &str) {
    let _ = CONFIG_OVERRIDE.set(toml.to_string());
}

/// 把 HOME 指向进程专属临时目录,并把 **cwd** 也挪进去。
///
/// cwd 也要挪:agent 的初始工作区取自 `current_dir()` —— `cargo test` 的
/// cwd 是包目录(`src-tauri/`),于是 `project` scope 的记忆会写进
/// **仓库里**(`src-tauri/.zhuye/...`)。能力覆盖层绝不能污染工作树,
/// 所以连 cwd 一起沙箱化。
///
/// 基目录可用 env `REFLECT_TEST_HOME` 覆盖；默认使用随机唯一临时目录。
/// `ipc_restart.rs` 用覆盖项在**两个进程**间共享同一份
/// `~/.zhuye`,复刻「退出后重启」的恢复场景。
pub fn init_isolated_env() {
    ENV_INIT.call_once(|| {
        let base = std::env::var_os("REFLECT_TEST_HOME").map_or_else(
            || {
                tempfile::Builder::new()
                    .prefix("reflect-desktop-capability-")
                    .tempdir()
                    .expect("create unique capability directory")
                    .keep()
            },
            std::path::PathBuf::from,
        );
        let home = base.join("home");
        // 核心 crate 的数据目录 = `$HOME/.zhuye`(不设 ZHUYE_HOME,让会话树与
        // 配置/记忆/任务落在同一个根上,与真实安装一致)。
        let data = home.join(".zhuye");
        let workspace = base.join("workspace");
        std::fs::create_dir_all(&data).expect("create isolated .zhuye");
        std::fs::create_dir_all(&workspace).expect("create isolated workspace");
        // 最小配置:关掉全部内置 hook(能力层只验行为语义,不验 hook 计时)。
        // config.toml 必须存在 —— 否则 ConfigWatcher 启动即报错。
        // 测试二进制可用 [`set_config_before_install`] 在首次 harness() 前
        // 换成自己的配置(如指向本地 mock LLM 服务)。
        // **只在文件不存在时写**:共享 HOME 的重启恢复场景
        // (`ipc_restart.rs`)里,阶段二进程必须看到阶段一留下的配置,
        // 不能被默认值覆盖。普通二进制基目录是全新的,行为不变。
        let config_path = data.join("config.toml");
        if !config_path.exists() {
            let config = CONFIG_OVERRIDE.get().cloned().unwrap_or_else(|| {
                "# 能力覆盖层最小配置:关闭全部内置 hook\n[hooks]\nenabled = []\n".to_string()
            });
            std::fs::write(&config_path, config).expect("write isolated config.toml");
        }
        // SAFETY: 仅在 Once 保护的初始化阶段调用;此时测试线程尚未开始,
        // 进程内没有并发读写环境变量 / cwd 的其它线程。
        unsafe {
            // 目录覆盖项和 provider 凭证可能绕过隔离 HOME 或连接真实服务。
            for key in [
                "ZHUYE_HOME",
                "ZHUYE_HUMAN_INPUT_DIR",
                "ZHUYE_ROLLOUT_BASE",
                "ZHUYE_QUOTA_STATE",
                "ZHUYE_SESSION_ID",
                "ZHUYE_SANDBOX_WRITABLE",
                "ZHUYE_UNTRUSTED_ALLOW_BARE",
                "ZHUYE_MODEL",
                "ZHUYE_PROVIDER",
                "ZHUYE_APPROVALS",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "OLLAMA_API_KEY",
                "OLLAMA_HOST",
                "BRAVE_API_KEY",
            ] {
                std::env::remove_var(key);
            }
            std::env::set_var("HOME", &home);
        }
        std::env::set_current_dir(&workspace).expect("enter isolated workspace");
    });
}

/// 取共享夹具(首次调用时构建 app)。
///
/// ⚠️ 返回的是**互斥锁的守卫** —— 它在函数返回时就被释放。若把它留在
/// 作用域里再调 [`invoke`],会**死锁**(同一把锁)。要在 app 上做一次性
/// 的注册(如 `listen`),用 [`listen`] 这类内部加锁的助手,别自己攥着
/// 守卫不放。
pub fn harness() -> MutexGuard<'static, Harness> {
    let cell = HARNESS.get_or_init(|| {
        init_isolated_env();
        let app = reflect_desktop_lib::configure(mock_builder())
            .build(mock_context(noop_assets()))
            .expect("build mock app (真实命令注册表)");

        // 与生产 setup 对齐:装 AgentThread(注册内置工具、建 ModelRegistry、
        // 起 cron driver / MCP bootstrap / activity logger)。
        // install 内部 tokio::spawn 了 submission loop —— 必须在持有 runtime
        // 的上下文里调用,否则 loop 会随用例结束而消失。
        {
            let rt = runtime();
            // install 内部 `tokio::spawn(submission loop)` —— 必须挂在**进程级**
            // runtime 上(否则用例一结束 loop 就没了)。`block_on` 让异步
            // install 在同一个 runtime 上跑完;spawn 出去的任务随 runtime
            // 活到进程退出(与原先 `enter()` 的语义一致)。
            rt.block_on(async {
                app.state::<MinimalAgent>().install_agent_thread().await;
            });
        }

        // 与生产 setup 对齐的第二件事:起**事件转发器** —— agent 的
        // session broadcast → Tauri `reflect_event` 通道 → 前端。
        // 这段是「UI 点一下 → 命令 → agent → 事件回前端」链路的最后一环,
        // 不起它就验不到事件信封的线上形状。
        {
            let agent = app.state::<MinimalAgent>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let session_rx = agent.subscribe_session();
                reflect_desktop_lib::events::forward_agent_events(app_handle, session_rx).await;
            });
        }

        // 与生产 install 6a-2 对齐:side-channel 终态补发(driver 的
        // Done / Cancelled / Error → reflect_event)。夹具未 set_app_handle,
        // install 里的自动 spawn 会跳过,这里手动起。
        {
            let registry = app.state::<MinimalAgent>().side_channel_registry();
            reflect_desktop_lib::state::side_channel_forwarder::spawn_side_channel_forwarder(
                app.handle().clone(),
                &registry,
            );
        }

        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("build mock webview");

        Mutex::new(Harness { app, webview })
    });
    cell.lock().unwrap_or_else(|e| e.into_inner())
}

/// 在 app 上注册一个事件监听器(内部加锁,调用后立刻释放)。
///
/// 存在的理由:`harness()` 返回的是互斥锁守卫,把它攥在手里再调
/// [`invoke`] 会死锁。注册监听器这种「一次性设置」用本函数,拿不到
/// 守卫就不会踩坑。
pub fn listen<F>(name: &str, handler: F)
where
    F: Fn(tauri::Event) + Send + 'static,
{
    use tauri::Listener;
    let h = harness();
    h.app.listen(name, handler);
}

/// 经真实 IPC 通路调一条命令,返回 `Ok(结果)` / `Err(错误)`。
///
/// 走的是与前端 `invoke()` 相同的通道:`InvokeRequest` → 注册表 → 真命令体。
/// 超时按**失败**处理(不是挂死)—— 命令没注册时后端不会回响应。
pub fn invoke(cmd: &str, body: Value) -> Result<Value, Value> {
    let h = harness();
    let url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let request = InvokeRequest {
        cmd: cmd.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().expect("parse invoke url"),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let responder: Box<OwnedInvokeResponder<MockRuntime>> =
        Box::new(move |_webview, _cmd, response, _cb, _err| {
            let _ = tx.send(response);
        });
    h.webview.clone().on_message(request, responder);
    drop(h);
    match rx.recv_timeout(COMMAND_TIMEOUT) {
        Ok(InvokeResponse::Ok(body)) => Ok(body.deserialize::<Value>().unwrap_or(Value::Null)),
        Ok(InvokeResponse::Err(InvokeError(v))) => Err(v),
        Err(_) => panic!(
            "command `{cmd}` timed out after {}s —— 命令未注册,或命令体挂住了",
            COMMAND_TIMEOUT.as_secs()
        ),
    }
}

/// 调一条命令并要求成功;失败时把错误信息打进断言消息。
pub fn invoke_ok(cmd: &str, body: Value) -> Value {
    match invoke(cmd, body) {
        Ok(v) => v,
        Err(e) => panic!("command `{cmd}` expected Ok, got Err: {e}"),
    }
}

/// 调一条命令并要求失败;成功时把结果打进断言消息。
pub fn invoke_err(cmd: &str, body: Value) -> Value {
    match invoke(cmd, body) {
        Err(e) => e,
        Ok(v) => panic!("command `{cmd}` expected Err, got Ok: {v}"),
    }
}

/// 取托管状态(诊断用)。
pub fn agent() -> MinimalAgent {
    harness().app.state::<MinimalAgent>().inner().clone()
}

/// 工作区互斥锁 —— `set_workspace` / `git_*` / `file_*` 都是**全局**状态,
/// 并行跑会互相污染。涉及工作区的用例必须持有这把锁。
pub fn workspace_lock() -> MutexGuard<'static, ()> {
    WORKSPACE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// 持久化状态互斥锁 —— **改配置文档**的用例必须持有。
///
/// 真后端的配置命令(`upsert_mcp_server` / `lsp_set_enabled` /
/// `save_pipeline_config` / `add_schedule` / `toggle_plugin` …)都是
/// 「读快照 → 改一项 → 整份写回」。两个这样的命令**并行**跑就会丢更新:
/// 后写的拿的是更早的快照,把对方刚加的那项抹掉。
///
/// 这不是生产 bug —— 真实桌面的命令都从同一个 UI 线程发起,不会并发;
/// 但 vitest 层同理,能力覆盖层**并行**跑测试就会撞上。持锁把这类命令
/// 串起来,断言才是确定的。
pub fn state_lock() -> MutexGuard<'static, ()> {
    STATE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// 当前工作区路径。
pub fn current_workspace() -> String {
    invoke_ok("reflect_current_workspace", serde_json::json!({}))
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// 切到指定工作区(调用方须持有 [`workspace_lock`])。
pub fn set_workspace(path: &str) {
    invoke_ok("reflect_set_workspace", serde_json::json!({ "path": path }));
}

/// 建一个临时工作区目录(含一个探针文件),返回其路径。
pub fn temp_workspace(tag: &str) -> String {
    let dir = std::env::temp_dir().join(format!(
        "reflect-desktop-capability-{}-{tag}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("create temp workspace");
    std::fs::write(dir.join("probe.txt"), "capability layer probe\n").expect("write probe file");
    dir.display().to_string()
}
