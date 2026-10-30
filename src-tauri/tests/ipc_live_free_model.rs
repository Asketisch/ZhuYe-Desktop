//! 实模型演练层 · 桌面端 —— 真后端 + 真 AgentThread + 真**免费模型**。
//!
//! ## 为什么要有这一层
//!
//! L2(前端行为层)的后端是**模拟**的;L3(能力覆盖层)的后端是**真的**,
//! 但模型是**假的**(wiremock / 本地 mock LLM)。
//!
//! 假模型永远测不到:真实 HTTP 往返、真实 SSE 帧形状、真实模型的思考
//! 过程、真实限流(429)、真实截断续作、真实 provider 的工具调用质量。
//! 这一层把**免费模型池**接进同一条真链路:
//!
//! ```text
//! reflect_submit → AgentThread → HTTP → SSE 解析 → reflect_event 通道
//! ```
//!
//! 与 GUI 点一次「发送」是**同一条链**(同一个 `generate_handler!`
//! 注册表、同一个 AgentThread、同一个事件通道)。
//!
//! ## 口径(与 submodule `tests/live/` 严格一致)
//!
//! - 模型从 provider 清单**实时发现**(`model = "free"`),不写死 id ——
//!   免费集合由上游决定,写死必然腐烂;
//! - 断言只到**协议形状**(事件序 / 终态 / usage 字段 / 工具成对),
//!   **不断言回答文本** —— 真实模型输出不确定,逐字断言只会制造假失败;
//! - 上游限流(429)判为**跳过**而非失败 —— 测的是代码,不是配额。
//!
//! ## 跑法
//!
//! ```bash
//! REFLECT_LIVE=1 cargo test --test ipc_live_free_model -- --ignored --nocapture
//! ```
//!
//! 默认**不发起任何网络请求**:测试带 `#[ignore]`,且运行期还要
//! `REFLECT_LIVE=1` 才放行(双保险 —— 有人手滑 `--ignored` 也不会误打上游)。
//!
//! ## 环境变量
//!
//! | 变量 | 默认 | 说明 |
//! |---|---|---|
//! | `REFLECT_LIVE` | 空 | 设 `1` 才真跑 |
//! | `REFLECT_LIVE_PROVIDER` | `openai` | provider 名(`openai` / `ollama`) |
//! | `REFLECT_LIVE_BASE_URL` | `https://api.kilo.ai/api/gateway` | provider 端点 |
//! | `REFLECT_LIVE_API_KEY` | 空 | 免 Key 端点留空;dsh 网关填 forwardKey |
//! | `REFLECT_LIVE_MODELS` | 空 | 逗号分隔 model id;空则走 `free` 发现 |
//! | `REFLECT_LIVE_RETRIES` | `0` | 限流重试次数(默认**不重试**,见下) |
//! | `REFLECT_LIVE_RETRY_DELAY` | `65` | 重试间隔(秒)—— 必须 ≥ 凭据冷却窗(60s) |
//! | `REFLECT_LIVE_DRAIN_TIMEOUT` | `180` | 事件流等待预算(秒) |
//!
//! ### 为什么默认不重试
//!
//! 上游 429 会让凭据进入 **60s 冷却**,而冷却表是**进程内**的 —— 同一进程
//! 内重试必然直接撞上冷却,拿到 `ALL_CREDENTIALS_EXHAUSTED(0 tried)`。
//! 真要重试,得让 `REFLECT_LIVE_RETRIES > 0` **且** `REFLECT_LIVE_RETRY_DELAY`
//! 覆盖冷却窗(默认 65s)。与 submodule `tests/live/`「限流必须换新会话」的
//! 结论同源。

mod common;

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// 事件通道名 —— 与 `src-tauri/src/events.rs` 的 emit 名一致。
const EVENT_CHANNEL: &str = "reflect_event";

/// 默认端点:Kilo 免费池(免 Key、零外部依赖)。
const DEFAULT_BASE_URL: &str = "https://api.kilo.ai/api/gateway";

/// 合成 prompt —— **不含任何真实仓库内容**。
///
/// 免费池的模型卡明示 prompt 可能被上游记录,所以这一层只用合成数据。
/// 同时显式声明「不要用工具」:模型若真去调工具,会引入审批/副作用
/// 变量,让协议形状断言变得不确定。
const PROMPT: &str = "Reply with exactly: PONG. Do not use any tools.";

// ============================================================================
// 用例结果输出 —— 供 `tests/live/run.sh` 折叠进门禁用例表
// ============================================================================

/// 打一条用例结果。格式与 `tests/lib.sh` 的 `suite_absorb` 对齐:
/// `LIVE_CASE\t<用例名>\t<PASS|FAIL|SKIP>\t<原因>`。
///
/// 失败项同时记进 `FAILURES` —— 测试跑完统一 panic,让 `cargo test`
/// 的退出码也变非零(门禁既看逐用例结果,也看退出码)。
fn case(name: &str, status: &str, reason: &str) {
    println!("LIVE_CASE\t{name}\t{status}\t{reason}");
    if status == "FAIL" {
        FAILURES
            .lock()
            .expect("FAILURES lock")
            .push(format!("{name}: {reason}"));
    }
}

/// 失败用例清单 —— 跑完统一 panic。
static FAILURES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

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

// ============================================================================
// 配置 —— 指向免费池的隔离 config.toml
// ============================================================================

/// TOML 字符串转义(只处理引号与反斜杠 —— key / url 里只有这两种)。
fn toml_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 构造隔离 HOME 里的 `config.toml`。
///
/// ⚠️ OpenAI 兼容端点必须用 **`[[openai.credentials]]` 数组形态**,不能用顶层
/// 单值 `api_key` —— `build_openai_pool` 在「数组为空且 api_key 为空」时
/// **直接不注册该 provider**(免 Key 端点就注册不上)。数组形态里
/// `api_key = ""` 会正常构造出 client,且 `OpenAIClient` 对空 key
/// **不发 Authorization 头** —— 这正是免 Key 免费池要的。
///
/// `ollama` provider 走**原生** `/api/chat`(不是 OpenAI 兼容的
/// `/v1/chat/completions`),配置段是 `[ollama]`。
fn config_toml(provider: &str, base_url: &str, api_key: &str, model: &str) -> String {
    let base_url = toml_escape(base_url);
    let api_key = toml_escape(api_key);
    let model = toml_escape(model);
    match provider {
        "ollama" => format!(
            r#"# 实模型演练层配置(隔离 HOME 内,不影响开发者真实 ~/.zhuye)
[hooks]
enabled = []

[active]
provider = "ollama"

[ollama]
base_url = "{base_url}"
model = "{model}"
"#
        ),
        _ => format!(
            r#"# 实模型演练层配置(隔离 HOME 内,不影响开发者真实 ~/.zhuye)
[hooks]
enabled = []

[active]
provider = "openai"

[openai]
base_url = "{base_url}"
timeout_secs = 300
model = "{model}"

[[openai.credentials]]
label = "live-free"
api_key = "{api_key}"
base_url = "{base_url}"

[model_discovery]
enabled = true
timeout_secs = 30
"#
        ),
    }
}

// ============================================================================
// 一轮全链路的结局
// ============================================================================

enum Outcome {
    /// 协议形状全部符合。
    Passed(String),
    /// 上游限流 —— 环境状态,不是产品缺陷 → 跳过。
    RateLimited(String),
    /// 模型不支持 tools 等「能力不匹配」→ 跳过。
    Unsupported(String),
    /// 其他环境态(配额耗尽 / 上游空回复)→ 跳过。
    Skipped(String),
    /// 真的坏了 → 失败。
    Failed(String),
}

/// 从一条错误事件里判断这是限流、能力不支持,还是真失败。
///
/// 引擎的错误码(`reflect-core/src/graph/nodes/retry.rs::error_code`):
/// `RATE_LIMITED` / `ALL_CREDENTIALS_EXHAUSTED` / `AUTH_FAILED` /
/// `INVALID_REQUEST` / `PROVIDER_ERROR` / `OVERLOADED` / `MAX_ATTEMPTS`。
/// 限流与环境配额有关 → 跳过;能力不匹配(模型不支持 tools)→ 跳过;
/// 其余 → 真失败。
fn classify_error(code: &str, message: &str, details: Option<&Value>) -> Outcome {
    let hay = format!("{code} {message}").to_lowercase();
    // `ALL_CREDENTIALS_EXHAUSTED` 只是「池内全挂了」的壳 —— 要看
    // `details.tried` 里每个 candidate 的 outcome 才知道是不是限流。
    let tried = details
        .and_then(|d| d.get("tried"))
        .and_then(|t| t.as_array());
    let tried_empty = tried.map(|a| a.is_empty()).unwrap_or(true);
    let tried_says = |needle: &str| -> bool {
        tried
            .map(|arr| {
                arr.iter().any(|c| {
                    c.get("outcome")
                        .and_then(|o| o.as_str())
                        .map(|o| o.to_lowercase().contains(needle))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    };

    // 限流:显式码 / 文案 / `tried` 里的 rate_limited outcome。
    if code.eq_ignore_ascii_case("RATE_LIMITED")
        || tried_says("rate_limited")
        || hay.contains("429")
        || hay.contains("rate_limit")
        || hay.contains("rate limit")
        || hay.contains("free usage limit")
        || hay.contains("quota")
        || hay.contains("limit_reached")
        || hay.contains("limit reached")
    {
        return Outcome::RateLimited(format!("{code}: {message}"));
    }
    // 池被**清空**(`tried` 为空)—— 冷却余波:上一轮的 429 把凭据打进了
    // 冷却,本轮池里一个候选都没有 → 引擎报 `ALL_CREDENTIALS_EXHAUSTED (0 tried)`。
    // 这仍是配额态,不是代码缺陷 —— 判跳过。
    if code.eq_ignore_ascii_case("ALL_CREDENTIALS_EXHAUSTED") && tried_empty {
        return Outcome::RateLimited(format!("{code}: {message}"));
    }
    if (hay.contains("tool") && (hay.contains("400") || hay.contains("not support")))
        || hay.contains("does not support")
        || hay.contains("unsupported")
    {
        return Outcome::Unsupported(format!("{code}: {message}"));
    }
    // 地区门:免费车道按出口 IP 判地区(403 REGION_BLOCKED /
    // "not available in your country")。这是**环境状态**,换出口即可 ——
    // 判失败就是在测地理围栏,不是测代码。
    if code.eq_ignore_ascii_case("REGION_BLOCKED")
        || hay.contains("region")
        || hay.contains("not available in your country")
        || hay.contains("not available in your region")
    {
        return Outcome::Unsupported(format!("{code}: {message}"));
    }
    Outcome::Failed(format!("{code}: {message}"))
}

/// 本轮观察到的事件统计。
#[derive(Default)]
struct Observed {
    turn_started: bool,
    content_bytes: usize,
    token_count_seen: bool,
    token_count_fields_ok: bool,
    total_tokens: u64,
    tool_begin: usize,
    tool_end: usize,
    turn_status: Option<String>,
    turn_id: Option<String>,
    error: Option<(String, String, Option<Value>)>,
}

/// 解析一条 `reflect_event` 载荷(线格式:`{"id":…,"msg":{"type":…}}`)。
fn observe(payload: &str, obs: &mut Observed) {
    let Ok(v) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    let msg = &v["msg"];
    let ty = msg["type"].as_str().unwrap_or_default().to_string();
    match ty.as_str() {
        "turn_started" => obs.turn_started = true,
        "agent_message_delta" => {
            obs.content_bytes += msg["delta"].as_str().unwrap_or_default().len();
        }
        "agent_message" => {
            obs.content_bytes += msg["text"].as_str().unwrap_or_default().len();
        }
        "thinking_delta" => {
            obs.content_bytes += msg["delta"].as_str().unwrap_or_default().len();
        }
        "token_count" => {
            obs.token_count_seen = true;
            // usage 四字段:input / output / cached / total。
            let has_all = [
                "input_tokens",
                "output_tokens",
                "cached_tokens",
                "total_tokens",
            ]
            .iter()
            .all(|k| msg[*k].is_number());
            obs.token_count_fields_ok = has_all;
            obs.total_tokens = obs
                .total_tokens
                .max(msg["total_tokens"].as_u64().unwrap_or(0));
        }
        "tool_call_begin" => obs.tool_begin += 1,
        "tool_call_end" => obs.tool_end += 1,
        "turn_complete" => {
            obs.turn_status = Some(msg["status"].as_str().unwrap_or_default().to_string());
            obs.turn_id = Some(msg["turn_id"].as_str().unwrap_or_default().to_string());
            // turn_complete 自带 usage —— 有些 provider 不发独立 token_count。
            obs.total_tokens = obs
                .total_tokens
                .max(msg["usage"]["total_tokens"].as_u64().unwrap_or(0));
        }
        "error" | "stream_error" => {
            let code = msg["code"].as_str().unwrap_or_default().to_string();
            let message = msg["message"].as_str().unwrap_or_default().to_string();
            let details = msg.get("details").cloned();
            obs.error = Some((code, message, details));
        }
        _ => {}
    }
}

/// 把观察结果判成结论(协议形状口径)。
fn judge(obs: &Observed) -> Outcome {
    if let Some((code, message, details)) = &obs.error {
        return classify_error(code, message, details.as_ref());
    }
    let mut problems: Vec<String> = Vec::new();
    if !obs.turn_started {
        problems.push("缺 turn_started".into());
    }
    if obs.content_bytes == 0 {
        // 零正文有三种截然不同的成因,**必须分开**:
        // - 零 token:上游根本没产出任何东西(配额耗尽 / 空回复)—— **环境态**;
        // - 有 token **且有工具调用**:模型这一轮只发了工具调用、没有文本 ——
        //   **正常**(工具调用本身消耗 output token,但不产生文本增量);
        // - 有 token 且**无**工具调用:模型确实答了,内容在链路上丢了 ——
        //   **产品缺陷**。
        if obs.total_tokens == 0 {
            return Outcome::Skipped(
                "回合结束但上游零 token 零内容 —— 环境态(配额/空回复),非产品缺陷".into(),
            );
        }
        if obs.tool_begin > 0 {
            return Outcome::Skipped(format!(
                "本轮只发了工具调用({} 次)没有文本 —— 模型行为,非产品缺陷",
                obs.tool_begin
            ));
        }
        // 「终态是 success 但一条内容都没有」= 上游把错误**放在流里**下发
        // (HTTP 200 + `data: {"error":{...}}` 帧)。这条帧没有 `choices`
        // 也没有 `usage`,provider 解析器若不认它就会被整块丢弃 → 上层
        // 收到「成功但零内容」的流,真实错误静默丢失。
        problems.push(if obs.turn_status.as_deref() == Some("success") {
            "终态是 success 但正文为零 —— 上游疑似在流里下发错误帧 \
             (HTTP 200 + `data: {\"error\":{...}}`),provider 解析器未识别"
                .into()
        } else {
            "没有任何正文/思考增量".into()
        });
    }
    if !obs.token_count_seen {
        problems.push("缺 token_count".into());
    } else if !obs.token_count_fields_ok {
        problems.push("token_count 的 usage 四字段不全".into());
    }
    if obs.total_tokens == 0 {
        problems.push("total_tokens = 0".into());
    }
    if obs.tool_begin != obs.tool_end {
        problems.push(format!(
            "工具调用不成对(begin={} end={})",
            obs.tool_begin, obs.tool_end
        ));
    }
    match obs.turn_status.as_deref() {
        None => problems.push("缺 turn_complete 终态".into()),
        Some(s) if s != "success" => problems.push(format!("turn_complete.status = {s}")),
        Some(_) => {}
    }
    if problems.is_empty() {
        Outcome::Passed(format!(
            "turn_id={} 正文={}B token={} 工具={}对",
            obs.turn_id.as_deref().unwrap_or("?"),
            obs.content_bytes,
            obs.total_tokens,
            obs.tool_begin
        ))
    } else {
        Outcome::Failed(problems.join(" / "))
    }
}

/// 跑一轮完整链路:注册监听 → 放行工具审批 → 提交 → 收事件 → 判定。
fn run_chain(turn_seq: u64, drain_timeout: Duration) -> Outcome {
    // 1. 监听 `reflect_event` —— 与前端 `listen("reflect_event")` 同一条通道。
    let (tx, rx): (Sender<String>, Receiver<String>) = channel();
    common::listen(EVENT_CHANNEL, move |event| {
        let _ = tx.send(event.payload().to_string());
    });

    // 2. 权限模式 → `bypass`:工具静默放行,不弹审批框。
    //    否则模型一旦发起工具调用就会停在审批门,事件流永远等不到终态。
    if let Err(e) = common::invoke("reflect_set_permission_mode", json!({ "mode": "bypass" })) {
        return Outcome::Failed(format!("reflect_set_permission_mode 失败: {e}"));
    }

    // 3. 提交一条真实 UserInput —— 与 GUI「发送」完全同形。
    let submission_id = format!("live-free-{turn_seq}");
    let body = json!({
        "submission": {
            "id": submission_id,
            "op": {
                "type": "user_input",
                "items": [{ "type": "text", "text": PROMPT }],
                "thread_settings": {}
            }
        }
    });
    if let Err(e) = common::invoke("reflect_submit", body) {
        return Outcome::Failed(format!("reflect_submit 失败: {e}"));
    }

    // 4. 收事件直到终态或预算耗尽。
    //    **错误事件也终止收流** —— 限流 / 鉴权失败等场景下引擎只发
    //    `error` / `stream_error` 而**没有** `turn_complete`,若只等终态
    //    会白等满整个预算(实测能把 429 拖成 3 分钟挂起)。
    let deadline = Instant::now() + drain_timeout;
    let mut obs = Observed::default();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let slice = (deadline - now).min(Duration::from_secs(5));
        match rx.recv_timeout(slice) {
            Ok(payload) => {
                observe(&payload, &mut obs);
                if obs.turn_status.is_some() || obs.error.is_some() {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    judge(&obs)
}

// ============================================================================
// 主用例
// ============================================================================

#[test]
#[ignore = "实模型演练层:需 REFLECT_LIVE=1 显式开启(默认不发网络请求)"]
fn live_free_model_practice() {
    if env_or("REFLECT_LIVE", "") != "1" {
        case(
            "live-free-model",
            "SKIP",
            "未设 REFLECT_LIVE=1 —— 不发起任何网络请求",
        );
        finish();
        return;
    }

    let provider = env_or("REFLECT_LIVE_PROVIDER", "openai");
    let base_url = env_or("REFLECT_LIVE_BASE_URL", DEFAULT_BASE_URL);
    let api_key = env_or("REFLECT_LIVE_API_KEY", "");
    let explicit = env_or("REFLECT_LIVE_MODELS", "");
    let retries = env_num("REFLECT_LIVE_RETRIES", 0);
    let retry_delay = env_num("REFLECT_LIVE_RETRY_DELAY", 65);
    let drain_timeout = Duration::from_secs(env_num("REFLECT_LIVE_DRAIN_TIMEOUT", 180));

    // 模型:显式指定优先,否则用 `free` —— 运行时从 provider 清单里挑。
    let model = if explicit.is_empty() {
        "free".to_string()
    } else {
        explicit
            .split(',')
            .next()
            .unwrap_or("free")
            .trim()
            .to_string()
    };

    // 配置必须在 harness 首次安装**之前**落定 —— AgentThread 安装那一刻
    // 就要建 ModelRegistry 并解析 model spec(可能要打清单端点)。
    common::set_config_before_install(&config_toml(&provider, &base_url, &api_key, &model));

    // ── 用例 1:model spec 解析成**真实**模型 id(不是占位串)─────────────
    let spec = common::agent().model_spec();
    if spec == "stub/test" || spec.ends_with("/free") || !spec.contains('/') {
        case(
            "free-model-resolution",
            "FAIL",
            &format!(
                "model spec = {spec} —— 未解析成真实模型 id(检查 [model_discovery] 与端点可达性)"
            ),
        );
        finish();
        return;
    }
    case(
        "free-model-resolution",
        "PASS",
        &format!("model spec = {spec}(清单实时发现)"),
    );

    // ── 用例 2:全链路一轮的协议形状 ───────────────────────────────────
    let mut last_rate_limit = String::new();
    for attempt in 0..=retries {
        match run_chain(attempt, drain_timeout) {
            Outcome::Passed(detail) => {
                case("full-chain-protocol-shape", "PASS", &detail);
                finish();
                return;
            }
            Outcome::RateLimited(reason) => {
                eprintln!("  ↳ 上游限流({attempt}/{retries}): {reason}");
                last_rate_limit = reason;
                if attempt < retries {
                    std::thread::sleep(Duration::from_secs(retry_delay));
                }
            }
            Outcome::Skipped(reason) => {
                case("full-chain-protocol-shape", "SKIP", &reason);
                return;
            }
            Outcome::Unsupported(reason) => {
                case("full-chain-protocol-shape", "SKIP", &reason);
                finish();
                return;
            }
            Outcome::Failed(reason) => {
                case("full-chain-protocol-shape", "FAIL", &reason);
                finish();
                return;
            }
        }
    }
    case(
        "full-chain-protocol-shape",
        "SKIP",
        &format!("上游限流,用尽重试仍未拿到一轮:{last_rate_limit}"),
    );
    finish();
}

/// 收尾:有失败用例 → panic(让 `cargo test` 退出码非零)。
fn finish() {
    let failures = FAILURES.lock().expect("FAILURES lock").clone();
    if !failures.is_empty() {
        panic!("实模型演练层失败:\n  - {}", failures.join("\n  - "));
    }
}
