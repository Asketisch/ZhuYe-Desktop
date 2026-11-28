//! 实模型演练层 · 桌面端全任务端到端 —— 上游 `tests/live/cli_e2e.toml` 接入。
//!
//! ## 这是什么
//!
//! `ipc_live_free_model.rs` 只跑一轮单次问答(协议形状冒烟);本文件把
//! 上游 CLI 端到端演练的**完整任务**(`cli_e2e.toml` 的 `[task]` 段)接进
//! **桌面 IPC 链路**:
//!
//! ```text
//! zhuye_set_permission_mode(plan) → zhuye_submit(任务)
//!   → plan 回合(只读调研)→ plan_ready(模型调 exit_plan_mode;
//!     模型收尾没交计划时驱动器先「催稿」再强制 exit 兜底)
//!   → zhuye_plan_approval(auto_mode) → 开发(工具调用 + 沙箱内 git)
//!   → zhuye_submit(continue_prompt 收尾) → 验收:产物 + 提交主题
//! ```
//!
//! 与 GUI 走的是**同一条链**(同一 `generate_handler!` 注册表、同一
//! AgentThread、同一事件通道、同一审批门),并覆盖 CLI 套件在桌面端
//! 无法覆盖的两件事:plan 审批流的真模型行为 + 沙箱 `.git` 归属快照的
//! 端到端回归点(agent 在沙箱内 init / add / commit 必须全部成功)。
//!
//! ## 跑法(本地专用,不进 CI 门禁)
//!
//! ```bash
//! ZHUYE_LIVE=1 bash tests/live/desktop_e2e.sh
//! # 或直接:
//! ZHUYE_LIVE=1 cargo test --test ipc_live_cli_e2e -- --ignored --nocapture
//! ```
//!
//! 默认**不发起任何网络请求**:`#[ignore]` + 运行期 `ZHUYE_LIVE=1` 双保险。
//!
//! ## 配置来源
//!
//! agent 配置读上游 `cli_e2e.toml`(查找顺序:环境变量 `ZHUYE_E2E_TOML`
//! → 上游工作检出 → submodule 镜像),字段可用 `ZHUYE_E2E_*` 环境变量
//! 按名覆盖(环境变量优先,与上游 `cli_e2e_lib.load_config` 同口径)。
//! 找不到配置时 SKIP,不失败 —— 本文件是演练,不是门禁。
//!
//! ## 断言口径
//!
//! 结构化检查项:协议形状(plan 产出 / 审批进入开发 / 工具成对 / usage)
//! + 任务验收(expect_artifact 存在、expect_commit_subject 匹配)。不断言
//! 模型文本内容。上游限流/地区门判为 SKIP 而非失败 —— 测的是代码,
//! 不是配额。`ZHUYE_E2E_DEBUG=1` 时逐事件转储到 stderr 供定位。

mod common;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// 事件通道名 —— 与 `src-tauri/src/events.rs` 的 emit 名一致。
const EVENT_CHANNEL: &str = "zhuye_event";

/// toml 查找候选(依次探测;`ZHUYE_E2E_TOML` 恒最优先):
/// 1. 上游工作检出(`../ZhuYe`,与桌面仓同级的 ZhuYe 仓库);
/// 2. submodule 镜像(用户手工拷入本地 toml 时生效 —— toml 含密钥,
///    是 gitignore 文件,不会随 submodule 分发)。
const TOML_CANDIDATES: [&str; 2] = [
    "../ZhuYe/tests/live/cli_e2e.toml",
    "zhuye-agent/tests/live/cli_e2e.toml",
];

/// 模型收尾没交计划时的「催稿」指令(plan 模式内续作)。
const PLAN_NUDGE: &str = "请把你的方案整理成正式计划:写清要创建/修改的文件、关键步骤与验证方式,然后调用 exit_plan_mode 工具提交计划等待用户确认。不要开始写代码。";

/// 工作区播种的 README(与上游 `sc_plan.py` 同一份夹具,保证任务语境一致)。
const README_FIXTURE: &str = r#"# 烽火 Fanfire

烽火是一个(虚构的)高性能日志采集器,单二进制、零依赖、吞吐 100 万行/秒。

## 特性
- 单二进制分发,开箱即用
- 内存占用 < 30MB
- 内置 Prometheus 指标端点

## 快速开始
fanfire --config fanfire.toml
"#;

// ============================================================================
// 用例结果输出 —— 供 tests/live/desktop_e2e.sh 折叠(格式同 lib.sh suite_absorb)
// ============================================================================

static FAILURES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

fn case(name: &str, status: &str, reason: &str) {
    println!("LIVE_CASE\t{name}\t{status}\t{reason}");
    if status == "FAIL" {
        FAILURES
            .lock()
            .expect("FAILURES lock")
            .push(format!("{name}: {reason}"));
    }
}

fn finish() {
    let failures = FAILURES.lock().expect("FAILURES lock").clone();
    if !failures.is_empty() {
        panic!("桌面端到端演练失败:\n  - {}", failures.join("\n  - "));
    }
}

fn env_or(key: &str, default: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => default.to_string(),
    }
}

fn env_num(key: &str, default: u64) -> u64 {
    env_or(key, &default.to_string())
        .parse::<u64>()
        .unwrap_or(default)
}

fn debug_enabled() -> bool {
    env_or("ZHUYE_E2E_DEBUG", "") == "1"
}

// ============================================================================
// cli_e2e.toml 加载(字段级 ZHUYE_E2E_* 覆盖,环境变量优先)
// ============================================================================

struct E2eConfig {
    base_url: String,
    api_key: String,
    model: String,
    endpoint: String,
    context_window: Option<u64>,
    effort: String,
    phase_timeout: u64,
    prompt: String,
    continue_prompt: String,
    expect_artifact: String,
    expect_commit: String,
}

/// 找到并解析 cli_e2e.toml;`Err(reason)` = 找不到/解析失败(调用方 SKIP)。
fn load_e2e_config() -> Result<E2eConfig, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let toml_path = match std::env::var("ZHUYE_E2E_TOML") {
        Ok(explicit) if !explicit.trim().is_empty() => PathBuf::from(explicit),
        _ => TOML_CANDIDATES
            .iter()
            .map(|c| manifest.join("..").join(c))
            .find(|p| p.is_file())
            .ok_or_else(|| {
                format!(
                    "候选路径均不存在:{}(可用 ZHUYE_E2E_TOML 指定)",
                    TOML_CANDIDATES.join(" / ")
                )
            })?,
    };
    let raw = std::fs::read_to_string(&toml_path)
        .map_err(|e| format!("读 {}: {e}", toml_path.display()))?;
    let value: toml::Value =
        toml::from_str(&raw).map_err(|e| format!("解析 {}: {e}", toml_path.display()))?;
    let empty = toml::Value::Table(Default::default());
    let endpoint = value.get("endpoint").unwrap_or(&empty);
    let run = value.get("run").unwrap_or(&empty);
    let task = value.get("task").unwrap_or(&empty);

    let str_field = |table: &toml::Value, key: &str, env_key: &str, default: &str| -> String {
        let from_toml = table
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or(default)
            .to_string();
        env_or(env_key, &from_toml)
    };
    let base_url = str_field(endpoint, "base_url", "ZHUYE_E2E_BASE_URL", "");
    let api_key = str_field(endpoint, "api_key", "ZHUYE_E2E_API_KEY", "");
    let model = str_field(endpoint, "model", "ZHUYE_E2E_MODEL", "");
    let endpoint_kind = str_field(endpoint, "endpoint", "ZHUYE_E2E_ENDPOINT", "openai");
    let context_window = {
        let from_toml = endpoint.get("context_window").and_then(|v| v.as_integer());
        match env_or("ZHUYE_E2E_CONTEXT_WINDOW", "") {
            v if !v.is_empty() => v.parse::<u64>().ok(),
            _ => from_toml.map(|w| w as u64),
        }
    };
    let effort = str_field(run, "effort", "ZHUYE_E2E_EFFORT", "xhigh");
    let phase_timeout = {
        let from_toml = run
            .get("phase_timeout")
            .and_then(|v| v.as_integer())
            .unwrap_or(1200) as u64;
        env_num("ZHUYE_E2E_PHASE_TIMEOUT", from_toml)
    };
    let prompt = task
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let continue_prompt = task
        .get("continue_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let expect_artifact = str_field(task, "expect_artifact", "ZHUYE_E2E_EXPECT_ARTIFACT", "");
    let expect_commit = str_field(task, "expect_commit_subject", "ZHUYE_E2E_EXPECT_COMMIT", "");
    if base_url.is_empty() || model.is_empty() || prompt.is_empty() {
        return Err(format!(
            "配置不完整(base_url / model / task.prompt 必填): {}",
            toml_path.display()
        ));
    }
    Ok(E2eConfig {
        base_url,
        api_key,
        model,
        endpoint: endpoint_kind,
        context_window,
        effort,
        phase_timeout,
        prompt,
        continue_prompt,
        expect_artifact,
        expect_commit,
    })
}

/// 生成隔离 HOME 的引擎 config.toml —— 与上游 `cli_e2e_lib.engine_config_toml`
/// 同一份形态(`[[model_group]]` 组形态 + sandbox + plugins),桌面嵌入
/// 引擎与 CLI 读同一份 `zhuye-config` schema。
fn engine_config_toml(cfg: &E2eConfig) -> String {
    let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    let mut lines = vec![
        "# 由桌面端到端演练生成 —— 隔离 HOME 内的独立引擎配置。".to_string(),
        "[active]".to_string(),
        "group = \"e2e\"".to_string(),
        String::new(),
        "[[model_group]]".to_string(),
        "id = \"e2e\"".to_string(),
        format!("endpoint = {}", q(&cfg.endpoint)),
        format!("api_key = {}", q(&cfg.api_key)),
        format!("base_url = {}", q(&cfg.base_url)),
        format!("model = {}", q(&cfg.model)),
        "responses_api = false".to_string(),
        "credentials = []".to_string(),
        String::new(),
    ];
    if let Some(window) = cfg.context_window {
        lines.push("[context_windows.entries]".to_string());
        lines.push(format!("{} = {window}", q(&cfg.model)));
        lines.push(String::new());
    }
    lines.extend([
        "[sandbox]".to_string(),
        "os_level = true".to_string(),
        "writable_dirs = []".to_string(),
        "allow_network = true".to_string(),
        String::new(),
        "[plugins]".to_string(),
        "enabled_plugins = []".to_string(),
        "disabled_plugins = []".to_string(),
    ]);
    lines.join("\n")
}

// ============================================================================
// 事件观测与阶段驱动
// ============================================================================

#[derive(Default)]
struct Observed {
    /// 按出现顺序登记的 turn id。
    turn_ids: Vec<String>,
    turn_status: HashMap<String, String>,
    plan_ready: Option<(String, String)>, // (plan_id, markdown)
    plan_approved: bool,
    mode_changes: Vec<(String, String)>, // (from, to)
    tool_begin: usize,
    tool_end: usize,
    total_tokens: u64,
    error: Option<(String, String, Option<Value>)>,
    /// 事件类型计数(诊断转储用)。
    event_counts: HashMap<String, usize>,
    /// 最近 12 条事件的紧凑摘要(诊断转储用)。
    recent: Vec<String>,
}

fn observe(payload: &str, obs: &mut Observed) {
    let Ok(v) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    let msg = &v["msg"];
    let ty = msg["type"].as_str().unwrap_or_default().to_string();
    *obs.event_counts.entry(ty.clone()).or_insert(0) += 1;
    if debug_enabled() {
        eprintln!("[e2e-event] {ty} {}", {
            let brief = serde_json::to_string(msg).unwrap_or_default();
            brief.chars().take(160).collect::<String>()
        });
    }
    match ty.as_str() {
        "turn_started" => {
            let id = msg["turn_id"].as_str().unwrap_or_default().to_string();
            if !id.is_empty() && !obs.turn_ids.contains(&id) {
                obs.turn_ids.push(id);
            }
        }
        "turn_complete" => {
            let id = msg["turn_id"].as_str().unwrap_or_default().to_string();
            obs.turn_status
                .insert(id, msg["status"].as_str().unwrap_or_default().to_string());
            obs.total_tokens = obs
                .total_tokens
                .max(msg["usage"]["total_tokens"].as_u64().unwrap_or(0));
        }
        "plan_ready" => {
            obs.plan_ready = Some((
                msg["plan_id"].as_str().unwrap_or_default().to_string(),
                msg["markdown"].as_str().unwrap_or_default().to_string(),
            ));
        }
        "plan_approved" => obs.plan_approved = true,
        "permission_mode_changed" => {
            obs.mode_changes.push((
                msg["from"].as_str().unwrap_or_default().to_string(),
                msg["to"].as_str().unwrap_or_default().to_string(),
            ));
        }
        "tool_call_begin" => obs.tool_begin += 1,
        "tool_call_end" => obs.tool_end += 1,
        "token_count" => {
            obs.total_tokens = obs
                .total_tokens
                .max(msg["total_tokens"].as_u64().unwrap_or(0));
        }
        "error" | "stream_error" => {
            obs.error = Some((
                msg["code"].as_str().unwrap_or_default().to_string(),
                msg["message"].as_str().unwrap_or_default().to_string(),
                msg.get("details").cloned(),
            ));
        }
        _ => {}
    }
    // 诊断转储:紧凑摘要(类型 + 关键标识)。
    let brief = match ty.as_str() {
        "turn_started" | "turn_complete" => {
            format!("turn_id={} status={:?}", msg["turn_id"].as_str().unwrap_or("?"), msg["status"].as_str())
        }
        "plan_ready" => format!("plan_id={} md={} 字符", msg["plan_id"].as_str().unwrap_or("?"),
            msg["markdown"].as_str().unwrap_or("").chars().count()),
        _ => String::new(),
    };
    obs.recent.push(if brief.is_empty() { ty } else { format!("{ty}({brief})") });
    if obs.recent.len() > 12 {
        obs.recent.remove(0);
    }
}

/// 从错误事件判环境态(限流 / 地区门)还是真失败 —— 与 `ipc_live_free_model`
/// 的 `classify_error` 同口径。`Some(kind)` = 环境态(演练判 SKIP)。
fn classify_error(code: &str, message: &str) -> Option<&'static str> {
    let hay = format!("{code} {message}").to_lowercase();
    if code.eq_ignore_ascii_case("RATE_LIMITED")
        || hay.contains("429")
        || hay.contains("rate_limit")
        || hay.contains("rate limit")
        || hay.contains("quota")
        || hay.contains("free usage limit")
    {
        return Some("上游限流 —— 环境态,非产品缺陷");
    }
    if code.eq_ignore_ascii_case("REGION_BLOCKED")
        || hay.contains("region")
        || hay.contains("not available in your country")
        || hay.contains("not available in your region")
    {
        return Some("地区门 —— 环境态,换出口即可");
    }
    if code.eq_ignore_ascii_case("ALL_CREDENTIALS_EXHAUSTED") {
        return Some("凭据池耗尽 —— 环境态");
    }
    None
}

/// 等待谓词成立:到点 / 引擎错误事件 / 通道关闭都终止。
///
/// `Err(kind, reason)`:`kind` ∈ {"timeout", "error-skip", "error-fail"}。
fn wait_for(
    rx: &Receiver<String>,
    obs: &mut Observed,
    deadline: Instant,
    mut predicate: impl FnMut(&Observed) -> bool,
) -> Result<(), (&'static str, String)> {
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(("timeout", diagnose(obs)));
        }
        let slice = (deadline - now).min(Duration::from_secs(5));
        match rx.recv_timeout(slice) {
            Ok(payload) => {
                observe(&payload, obs);
                if let Some((code, message, _)) = &obs.error {
                    return match classify_error(code, message) {
                        Some(kind) => Err(("error-skip", kind.to_string())),
                        None => Err(("error-fail", format!("引擎错误 {code}: {message}"))),
                    };
                }
                if predicate(obs) {
                    return Ok(());
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err(("timeout", "事件通道关闭".into()));
            }
        }
    }
}

/// 超时 / 卡死时的观测摘要 —— 不看它,20 分钟预算烧完只剩一句「耗尽」。
fn diagnose(obs: &Observed) -> String {
    let counts = {
        let mut pairs: Vec<_> = obs.event_counts.iter().map(|(k, v)| format!("{k}×{v}")).collect();
        pairs.sort();
        pairs.join(" ")
    };
    let modes = obs
        .mode_changes
        .iter()
        .map(|(f, t)| format!("{f}→{t}"))
        .collect::<Vec<_>>()
        .join(", ");
    let turns = obs
        .turn_ids
        .iter()
        .map(|id| {
            format!(
                "{}({})",
                &id[..id.len().min(8)],
                obs.turn_status.get(id).map(String::as_str).unwrap_or("进行中")
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "阶段预算耗尽。事件计数:[{counts}] 模式切换:[{modes}] 回合:[{turns}] 最近:{}",
        obs.recent.join(" | ")
    )
}

/// 提交一条用户输入(与 GUI「发送」完全同形)。
fn submit(id: &str, text: &str) -> Result<(), String> {
    common::invoke(
        "zhuye_submit",
        json!({
            "submission": {
                "id": id,
                "op": {
                    "type": "user_input",
                    "items": [{ "type": "text", "text": text }],
                    "thread_settings": {}
                }
            }
        }),
    )
    .map(|_| ())
    .map_err(|e| format!("zhuye_submit: {e}"))
}

/// 工作区验收:expect_artifact 存在 + git 提交主题匹配;返回问题清单。
fn verify_workspace(ws: &str, artifact: &str, commit_subject: &str) -> Vec<String> {
    let mut problems = Vec::new();
    let artifact_path = std::path::Path::new(ws).join(artifact);
    if !artifact_path.is_file() {
        problems.push(format!("产物不存在: {}", artifact_path.display()));
    }
    match Command::new("git")
        .args(["-C", ws, "log", "--format=%s"])
        .output()
    {
        Ok(out) if out.status.success() => {
            let subjects = String::from_utf8_lossy(&out.stdout);
            if !subjects.lines().any(|line| line.trim() == commit_subject) {
                problems.push(format!(
                    "提交主题未匹配(expect={commit_subject:?},got={:?})",
                    subjects.trim()
                ));
            }
        }
        Ok(out) => problems.push(format!(
            "git log 失败(仓库未初始化?): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Err(e) => problems.push(format!("git 不可执行: {e}")),
    }
    problems
}

// ============================================================================
// 主用例
// ============================================================================

#[test]
#[ignore = "实模型演练层:需 ZHUYE_LIVE=1 显式开启(默认不发网络请求)"]
fn live_cli_e2e_full_task() {
    if env_or("ZHUYE_LIVE", "") != "1" {
        case(
            "desktop-e2e",
            "SKIP",
            "未设 ZHUYE_LIVE=1 —— 不发起任何网络请求",
        );
        finish();
        return;
    }
    let cfg = match load_e2e_config() {
        Ok(cfg) => cfg,
        Err(reason) => {
            case(
                "desktop-e2e",
                "SKIP",
                &format!("找不到/无法解析 cli_e2e.toml:{reason}"),
            );
            finish();
            return;
        }
    };
    case(
        "cli-e2e 配置加载",
        "PASS",
        &format!(
            "model={} endpoint={} effort={} phase_timeout={}s",
            cfg.model, cfg.endpoint, cfg.effort, cfg.phase_timeout
        ),
    );

    // 配置必须在 harness 首次安装之前落定(ModelRegistry 在安装时构建)。
    common::set_config_before_install(&engine_config_toml(&cfg));

    // 模型 spec 解析成真实 id(不是占位串)。
    let spec = common::agent().model_spec();
    if spec == "stub/test" {
        case("model-spec 解析", "FAIL", &format!("model spec = {spec}"));
        finish();
        return;
    }
    case("model-spec 解析", "PASS", &format!("model spec = {spec}"));

    // 工作区:隔离 base 下的 workspace(夹具 cwd 即此处),播种 README。
    let home = common::isolated_home();
    let ws = home
        .parent()
        .map(|base| base.join("workspace"))
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));
    std::fs::create_dir_all(&ws).expect("create workspace");
    std::fs::write(ws.join("README.md"), README_FIXTURE).expect("seed README.md");
    let _guard = common::workspace_lock();
    common::set_workspace(ws.to_string_lossy().as_ref());
    case(
        "工作区播种",
        "PASS",
        &format!("{}(README.md 已就位)", ws.display()),
    );

    // 事件监听(先于一切 submit —— 与前端 listen 同一条通道)。
    let (tx, rx): (Sender<String>, Receiver<String>) = channel();
    common::listen(EVENT_CHANNEL, move |event| {
        let _ = tx.send(event.payload().to_string());
    });

    // 思考强度 + plan 模式(与上游 serve `--plan-mode` 同语义)。
    if let Err(e) = common::invoke("zhuye_set_effort", json!({ "level": cfg.effort })) {
        case("设置思考强度", "FAIL", &format!("zhuye_set_effort: {e}"));
        finish();
        return;
    }
    if let Err(e) = common::invoke("zhuye_set_permission_mode", json!({ "mode": "plan" })) {
        case(
            "进入 plan 模式",
            "FAIL",
            &format!("zhuye_set_permission_mode: {e}"),
        );
        finish();
        return;
    }

    let phase = Duration::from_secs(cfg.phase_timeout);
    let continue_rounds = env_num("ZHUYE_E2E_CONTINUE_ROUNDS", 1) as usize;
    let plan_nudges = env_num("ZHUYE_E2E_PLAN_NUDGES", 2) as usize;
    let mut obs = Observed::default();

    // ── 阶段 1:plan 回合(任务下发 → plan_ready)────────────────────────
    // 自适应驱动:模型按 plan 契约应当调 exit_plan_mode 产出 plan_ready;
    // 弱模型可能结束回合却不交计划 —— 先「催稿」(plan 模式内续作,不改
    // 语义),多次不中才 `zhuye_exit_plan_mode` 强制兜底(计划取
    // `.zhuye/plan/` 落盘文件,读不到是占位串 —— 开发回合仍有原始任务
    // 语境,结构不断)。回合结束但没 plan_ready 时**快速失败/推进**,
    // 不烧满整个预算。
    if let Err(e) = submit("live-cli-e2e-plan", &cfg.prompt) {
        case("任务下发", "FAIL", &e);
        finish();
        return;
    }
    let mut forced_plan = false;
    let plan_deadline = Instant::now() + phase;
    let plan_outcome: Result<(), String> = loop {
        let baseline = obs.turn_ids.len();
        match wait_for(&rx, &mut obs, plan_deadline, |o| {
            o.plan_ready.is_some()
                || o.turn_ids
                    .iter()
                    .skip(baseline)
                    .any(|id| o.turn_status.contains_key(id))
        }) {
            Err((kind, reason)) => break Err(match kind {
                "error-skip" => format!("SKIP:{reason}"),
                _ => reason,
            }),
            Ok(()) => {}
        }
        if obs.plan_ready.is_some() {
            break Ok(());
        }
        // 回合结束但没有 plan_ready —— 催稿 / 强制兜底。
        if forced_plan {
            break Err("强制 exit 后仍未收到 plan_ready".into());
        }
        if obs_nudge_count(&obs) <= plan_nudges {
            eprintln!("[e2e] plan 回合结束未交计划 —— 催稿");
            if let Err(e) = submit(&format!("live-cli-e2e-nudge-{}", obs_nudge_count(&obs)), PLAN_NUDGE) {
                break Err(format!("催稿提交失败: {e}"));
            }
            continue;
        }
        // 催稿用尽:强制 exit(引擎读 `.zhuye/plan/` 最新计划文件)。
        eprintln!("[e2e] 催稿用尽 —— 强制 zhuye_exit_plan_mode 兜底");
        forced_plan = true;
        if let Err(e) = common::invoke("zhuye_exit_plan_mode", json!({})) {
            break Err(format!("zhuye_exit_plan_mode: {e}"));
        }
    };
    let plan_via_forced = forced_plan && obs.plan_ready.is_some();
    match plan_outcome {
        Ok(()) => {
            let (_, markdown) = obs.plan_ready.clone().expect("plan_ready");
            let placeholder = markdown.contains("plan") && markdown.contains("占位");
            case(
                "plan 正式产出",
                if markdown.trim().is_empty() { "FAIL" } else { "PASS" },
                &format!(
                    "markdown {} 字符{}",
                    markdown.chars().count(),
                    if plan_via_forced {
                        if placeholder { "(强制兜底:占位计划)" } else { "(强制兜底:落盘计划)" }
                    } else {
                        ""
                    }
                ),
            );
        }
        Err(reason) => {
            let (status, detail) = match reason.strip_prefix("SKIP:") {
                Some(rest) => ("SKIP", rest.to_string()),
                None => ("FAIL", reason),
            };
            case("plan 正式产出", status, &detail);
            finish();
            return;
        }
    }

    // ── 审批:plan_ready → auto_mode(切自动批准编辑,对齐上游 on_plan_ready)──
    let (plan_id, _) = obs.plan_ready.clone().expect("plan_ready");
    if let Err(e) = common::invoke(
        "zhuye_plan_approval",
        json!({ "id": plan_id, "choice": "auto_mode" }),
    ) {
        case(
            "plan 审批(auto_mode)",
            "FAIL",
            &format!("zhuye_plan_approval: {e}"),
        );
        finish();
        return;
    }
    case(
        "plan 审批(auto_mode)",
        "PASS",
        &format!("plan_id={plan_id}"),
    );

    // ── 阶段 2:开发(审批后的回合推进到终态)──────────────────────────────
    // 批准后引擎要么在同一回合内继续开发,要么开新回合 —— 两种形态都
    // 归结为「等任一回合推进到终态」。
    if let Err((kind, reason)) = wait_for(&rx, &mut obs, Instant::now() + phase, |o| {
        o.turn_status
            .values()
            .any(|status| status == "success" || status == "aborted" || status == "failed")
    }) {
        case(
            "开发回合终态",
            if kind == "error-skip" { "SKIP" } else { "FAIL" },
            &reason,
        );
        finish();
        return;
    }
    let last_status = obs
        .turn_ids
        .iter()
        .rev()
        .find_map(|id| obs.turn_status.get(id).cloned())
        .unwrap_or_default();
    if last_status != "success" {
        case("开发回合终态", "FAIL", &format!("turn status = {last_status}"));
        finish();
        return;
    }
    case(
        "开发回合终态",
        "PASS",
        &format!(
            "工具 begin={} end={} tokens={}",
            obs.tool_begin, obs.tool_end, obs.total_tokens
        ),
    );

    // ── 阶段 3:验收(不齐则走 continue_prompt 收尾回合)────────────────────
    let ws_str = ws.to_string_lossy().into_owned();
    let mut verified = {
        let problems = verify_workspace(&ws_str, &cfg.expect_artifact, &cfg.expect_commit);
        case(
            "首轮验收(产物 + 提交)",
            if problems.is_empty() { "PASS" } else { "SKIP" },
            &if problems.is_empty() {
                format!("artifact={} 提交主题已匹配", cfg.expect_artifact)
            } else {
                format!("首轮未齐(进入收尾回合):{}", problems.join(";"))
            },
        );
        problems.is_empty()
    };
    for round in 1..=continue_rounds {
        if verified || cfg.continue_prompt.trim().is_empty() {
            break;
        }
        let baseline_turns = obs.turn_ids.len();
        if let Err(e) = submit(&format!("live-cli-e2e-continue-{round}"), &cfg.continue_prompt) {
            case("收尾回合下发", "FAIL", &e);
            finish();
            return;
        }
        if let Err((kind, reason)) = wait_for(&rx, &mut obs, Instant::now() + phase, |o| {
            o.turn_ids
                .iter()
                .skip(baseline_turns)
                .any(|id| o.turn_status.contains_key(id))
        }) {
            case(
                "收尾回合终态",
                if kind == "error-skip" { "SKIP" } else { "FAIL" },
                &reason,
            );
            finish();
            return;
        }
        let problems = verify_workspace(&ws_str, &cfg.expect_artifact, &cfg.expect_commit);
        if problems.is_empty() {
            verified = true;
            case(
                &format!("收尾回合 {round} 验收"),
                "PASS",
                &format!("artifact={} 提交主题已匹配", cfg.expect_artifact),
            );
        } else {
            case(
                &format!("收尾回合 {round} 验收"),
                "SKIP",
                &format!("仍未齐:{}", problems.join(";")),
            );
        }
    }
    if verified {
        case(
            "任务验收(产物 + 提交)",
            "PASS",
            &format!(
                "artifact={} 提交主题={:?}(沙箱内 git init/add/commit 全链路成功)",
                cfg.expect_artifact, cfg.expect_commit
            ),
        );
    } else {
        case(
            "任务验收(产物 + 提交)",
            "FAIL",
            &format!(
                "artifact 存在={} 提交主题={:?} 未匹配(收尾轮次={continue_rounds})",
                std::path::Path::new(&ws)
                    .join(&cfg.expect_artifact)
                    .is_file(),
                cfg.expect_commit
            ),
        );
    }

    // ── 协议形状总检 ─────────────────────────────────────────────────────
    if obs.tool_begin != obs.tool_end {
        case(
            "工具调用成对",
            "FAIL",
            &format!("begin={} end={}", obs.tool_begin, obs.tool_end),
        );
    } else if obs.tool_begin > 0 {
        case("工具调用成对", "PASS", &format!("{} 对", obs.tool_begin));
    }
    if obs.total_tokens == 0 {
        case("usage 上报", "FAIL", "total_tokens = 0");
    } else {
        case(
            "usage 上报",
            "PASS",
            &format!("total_tokens = {}", obs.total_tokens),
        );
    }
    let entered_plan = obs
        .mode_changes
        .iter()
        .any(|(_, to)| to == "plan");
    let left_plan = obs.mode_changes.iter().any(|(from, _)| from == "plan");
    if !entered_plan {
        case(
            "plan 模式进出留痕",
            "FAIL",
            &format!("未见进入 plan 的模式切换:{}", diagnose(&obs)),
        );
    } else if !left_plan {
        case(
            "plan 模式进出留痕",
            "FAIL",
            &format!("未见退出 plan 的模式切换:{}", diagnose(&obs)),
        );
    } else {
        case(
            "plan 模式进出留痕",
            "PASS",
            &format!(
                "{}",
                obs.mode_changes
                    .iter()
                    .map(|(f, t)| format!("{f}→{t}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        );
    }
    finish();
}

/// 已发催稿次数 = 提交 id 里 nudge 的计数(从回合数推:回合数 - 1 个 plan
/// 回合 = 催稿数;首个回合是任务本身)。
fn obs_nudge_count(obs: &Observed) -> usize {
    obs.turn_ids.len().saturating_sub(1)
}
