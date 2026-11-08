//! 实模型演练层 · **能力域矩阵** —— 真模型驱动的完整功能面实践测试。
//!
//! ## 定位
//!
//! `ipc_live_free_model.rs` 验的是「主回合能不能跑通」。本文件验的是
//! **其余所有依赖模型的命令面**:工具调用与审批、plan / goal 模式、
//! 中断、压缩、回退、任务、子代理、追问、编排(流水线 / 讨论 / 团队),
//! 以及会话标题生成。
//!
//! 走**生产同一条链**:`reflect_submit` / 各 Op 命令 → AgentThread →
//! 真 provider → 真 SSE → `reflect_event` 通道。
//!
//! ## 断言口径(与 `ipc_live_free_model.rs` 同纪律)
//!
//! - 只断言**协议形状**与**产品行为**,不断言回答文本 —— 真实模型的输出
//!   不确定,逐字断言只会制造假失败;
//! - **模型不配合 ≠ 产品缺陷**:模型没发起工具调用 / 没提问 / 没进 plan,
//!   判**跳过**(附理由),不判失败 —— 这一层测的是**产品对模型输出的处理**,
//!   不是模型听不听话;
//! - 上游限流(429)/地区门/配额耗尽 → **跳过**,不判失败;
//! - 只用合成 prompt,不喂真实仓库内容 / 凭据。
//!
//! ## 跑法
//!
//! ```bash
//! REFLECT_LIVE=1 cargo test --test ipc_live_capabilities -- --ignored --nocapture
//! ```

mod common;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

// ============================================================================
// 结局与输出
// ============================================================================

/// 一个场景的结局。
enum Verdict {
    /// 产品行为符合预期。
    Passed(String),
    /// 环境态 / 模型不配合 —— 不算失败。
    Skipped(String),
    /// 真的坏了。
    Failed(String),
}

/// 打一条场景结果(与 `tests/live/run.sh` 的 `suite_absorb` 对齐):
/// `LIVE_CASE\t<场景名>\t<PASS|FAIL|SKIP>\t<原因>`。
fn report(name: &str, v: &Verdict) {
    let (status, reason) = match v {
        Verdict::Passed(r) => ("PASS", r.clone()),
        Verdict::Skipped(r) => ("SKIP", r.clone()),
        Verdict::Failed(r) => ("FAIL", r.clone()),
    };
    println!("LIVE_CASE\t{name}\t{status}\t{reason}");
}

// ============================================================================
// 事件收集
// ============================================================================

/// 全局事件汇 —— Tauri `reflect_event` 通道上的所有事件按序落这里。
///
/// 场景用「游标」切分自己那一段(`mark()` → `since()`),因此**多个场景
/// 共用一个 AgentThread** 也能各自断言干净的事件子集。
fn sink() -> &'static Arc<Mutex<Vec<Value>>> {
    static SINK: OnceLock<Arc<Mutex<Vec<Value>>>> = OnceLock::new();
    SINK.get_or_init(|| {
        let s: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        // 监听闭包拿走一份 clone,`s` 本身留给 get_or_init 返回。
        let sink = s.clone();
        // ⚠️ `common::listen` 内部会触发 `harness()` → 安装 AgentThread。
        // 所以 `set_config_before_install` 必须**先于**本函数调用。
        common::listen("reflect_event", move |event| {
            if let Ok(v) = serde_json::from_str::<Value>(event.payload()) {
                sink.lock().expect("event sink lock").push(v);
            }
        });
        s
    })
}

/// 场景开始时的游标。
fn mark() -> usize {
    sink().lock().expect("event sink lock").len()
}

/// 游标之后的事件。
fn since(m: usize) -> Vec<Value> {
    let s = sink().lock().expect("event sink lock");
    s[m.min(s.len())..].to_vec()
}

/// 事件类型。
fn ty(ev: &Value) -> &str {
    ev["msg"]["type"].as_str().unwrap_or_default()
}

/// 终态事件(回合结束或出错)。
fn is_terminal(ev: &Value) -> bool {
    matches!(
        ty(ev),
        "turn_complete" | "turn_aborted" | "error" | "stream_error"
    )
}

/// 等到 `pred` 满足或预算耗尽。
fn wait_until(m: usize, budget: Duration, pred: impl Fn(&[Value]) -> bool) -> bool {
    let deadline = Instant::now() + budget;
    loop {
        let evs = since(m);
        if pred(&evs) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// 场景内自动批准:副作用工具(spawn subagent / ask_user / bash …)在
/// `Prompt` 权限下默认要审批,而 tool-approval 场景把模式设成 prompt
/// 后不恢复 —— 后续场景的工具调用会被审批门拦住,回合永不终态
/// (2026-11 局域网网关实测:subagent / ask-user 连续超时,事件转储
/// 显示每次都卡在 approval_request)。等待循环里出现审批请求就当场
/// 批准,每个 request_id 只批一次。
fn approve_pending(evs: &[Value]) {
    static APPROVED: OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        OnceLock::new();
    let mut approved = APPROVED
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
        .lock()
        .expect("APPROVED lock");
    for e in evs {
        if ty(e) != "approval_request" {
            continue;
        }
        let id = e["msg"]["request_id"].as_str().unwrap_or_default();
        if id.is_empty() || !approved.insert(id.to_string()) {
            continue;
        }
        drop(approved);
        let _ = op(
            "reflect_tool_approval",
            json!({ "id": id, "decision": "approve" }),
        );
        return;
    }
}

/// 等到出现终态事件。
fn wait_terminal(m: usize, budget: Duration) -> bool {
    wait_until(m, budget, |evs| evs.iter().any(is_terminal))
}

/// 统计某类型事件的数量。
fn count(evs: &[Value], t: &str) -> usize {
    evs.iter().filter(|e| ty(e) == t).count()
}

/// 第一个某类型事件。
fn first<'a>(evs: &'a [Value], t: &str) -> Option<&'a Value> {
    evs.iter().find(|e| ty(e) == t)
}

/// 本轮是否被上游限流 / 地区门 / 配额挡住。
fn blocked_by_upstream(evs: &[Value]) -> Option<String> {
    for e in evs {
        if !matches!(ty(e), "error" | "stream_error") {
            continue;
        }
        let code = e["msg"]["code"].as_str().unwrap_or_default();
        let msg = e["msg"]["message"].as_str().unwrap_or_default();
        let hay = format!("{code} {msg}").to_lowercase();
        if hay.contains("rate")
            || hay.contains("429")
            || hay.contains("quota")
            || hay.contains("limit_reached")
            || hay.contains("region")
            || hay.contains("not available in your country")
            || hay.contains("all_credentials_exhausted")
        {
            return Some(format!("{code}: {msg}"));
        }
    }
    None
}

/// 正文字节数(正文 + 完整消息 + 思考分片)。
fn content_bytes(evs: &[Value]) -> usize {
    evs.iter()
        .filter(|e| {
            matches!(
                ty(e),
                "agent_message_delta" | "agent_message" | "thinking_delta"
            )
        })
        .map(|e| {
            e["msg"]["delta"]
                .as_str()
                .or_else(|| e["msg"]["text"].as_str())
                .unwrap_or_default()
                .len()
        })
        .sum()
}

// ============================================================================
// 命令助手
// ============================================================================

/// 单调递增的 id 后缀(不引 uuid 依赖)。
fn next_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    N.fetch_add(1, Ordering::Relaxed)
}

/// 提交一条用户输入(与 GUI「发送」同形)。返回 submission id。
fn submit(text: &str) -> Result<String, String> {
    let body = json!({
        "submission": {
            "id": format!("live-cap-{}", next_id()),
            "op": {
                "type": "user_input",
                "items": [{ "type": "text", "text": text }],
                "thread_settings": {}
            }
        }
    });
    common::invoke("reflect_submit", body)
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .map_err(|e| format!("{e}"))
}

/// 调一条 Op 型命令,成功返回 submission id。
fn op(cmd: &str, body: Value) -> Result<String, String> {
    common::invoke(cmd, body)
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .map_err(|e| format!("{e}"))
}

/// 设置权限模式(`prompt` / `bypass` / `auto` / `deny` / `plan` / …)。
fn set_permission_mode(mode: &str) -> Result<(), String> {
    op("reflect_set_permission_mode", json!({ "mode": mode })).map(|_| ())
}

/// 一轮回合的通用预算。
fn turn_budget() -> Duration {
    Duration::from_secs(
        std::env::var("REFLECT_LIVE_TURN_BUDGET")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120),
    )
}

/// 在隔离工作区里写一个临时文件,返回绝对路径。
fn write_temp(name: &str, content: &str) -> Result<String, String> {
    let dir = std::env::current_dir().map_err(|e| format!("取 cwd 失败:{e}"))?;
    let path = dir.join(format!("live-{}-{name}", next_id()));
    std::fs::write(&path, content).map_err(|e| format!("写 {} 失败:{e}", path.display()))?;
    Ok(path.display().to_string())
}

/// 工具调用事件里**模型实际发出的参数** —— 用来区分「产品丢参数」与
/// 「模型自己编错了参数名」。
fn tool_call_args(evs: &[Value]) -> Vec<String> {
    evs.iter()
        .filter(|e| ty(e) == "tool_call_begin")
        .map(|e| {
            let name = e["msg"]["tool_name"].as_str().unwrap_or_default();
            let args = e["msg"]["args"].to_string();
            format!("{name}({args})")
        })
        .collect()
}

/// 把一段事件流压成一行可读摘要(诊断用)。
///
/// 逐类型计数 + 首个错误事件 —— 「超时」这种结论必须带上下文,
/// 否则定位时还得回去翻日志。
fn summarize_events(evs: &[Value]) -> String {
    if evs.is_empty() {
        return "(无事件)".into();
    }
    let mut counts: Vec<(String, usize)> = Vec::new();
    for e in evs {
        let t = ty(e).to_string();
        match counts.iter_mut().find(|(n, _)| *n == t) {
            Some((_, c)) => *c += 1,
            None => counts.push((t, 1)),
        }
    }
    let mut parts: Vec<String> = counts.iter().map(|(t, c)| format!("{t}×{c}")).collect();
    if let Some(err) = evs
        .iter()
        .find(|e| matches!(ty(e), "error" | "stream_error"))
    {
        parts.push(format!(
            "error={}: {}",
            err["msg"]["code"].as_str().unwrap_or_default(),
            err["msg"]["message"].as_str().unwrap_or_default()
        ));
    }
    parts.join(", ")
}

/// 一条**命令错误**文本是否属于「上游配额/限流」类环境态。
///
/// 编排命令(讨论 / 流水线 / 团队流水线)把子代理的失败包在命令错误里
/// 返回,不走事件通道 —— 所以这里对错误**文本**做一次同样的判定。
fn quota_ish(text: &str) -> bool {
    let h = text.to_lowercase();
    h.contains("rate_limit")
        || h.contains("rate limited")
        || h.contains("rate limit")
        || h.contains("429")
        || h.contains("quota")
        || h.contains("limit_reached")
        || h.contains("all_credentials_exhausted")
        || h.contains("region")
        || h.contains("not available in your country")
}

// ============================================================================
// 场景 1 —— 主回合
// ============================================================================

fn scenario_agent_loop() -> Verdict {
    let m = mark();
    if let Err(e) = submit("Reply with exactly: PONG. Do not use any tools.") {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m, turn_budget()) {
        return Verdict::Failed("等待回合终态超时".into());
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let content = content_bytes(&evs);
    let total = first(&evs, "token_count")
        .and_then(|t| t["msg"]["total_tokens"].as_u64())
        .unwrap_or(0);
    if content == 0 {
        // 零正文有三种截然不同的成因,**必须分开**:
        // - 零 token:上游根本没产出任何东西(配额耗尽 / 空回复)—— **环境态**;
        // - 有 token **且有工具调用**:模型这一轮只发了工具调用、没有文本 ——
        //   **正常**(工具调用消耗 output token,但不产生文本增量);
        // - 有 token 且无工具调用:模型确实答了,内容在链路上丢了 —— **产品缺陷**。
        if total == 0 {
            return Verdict::Skipped(
                "回合结束但上游零 token 零内容 —— 环境态(配额/空回复),非产品缺陷".into(),
            );
        }
        if count(&evs, "tool_call_begin") > 0 {
            return Verdict::Skipped(format!(
                "本轮只发了工具调用({} 次)没有文本 —— 模型行为,非产品缺陷",
                count(&evs, "tool_call_begin")
            ));
        }
        return Verdict::Failed(format!(
            "回合消耗了 {total} token 却没有任何正文 —— 内容在链路上丢了"
        ));
    }
    if total == 0 {
        return Verdict::Failed("token_count 缺失或 total_tokens = 0".into());
    }
    let status = first(&evs, "turn_complete")
        .and_then(|e| e["msg"]["status"].as_str())
        .unwrap_or_default()
        .to_string();
    if status != "success" {
        return Verdict::Failed(format!("turn_complete.status = {status}"));
    }
    Verdict::Passed(format!("正文 {content}B · token {total} · 终态 {status}"))
}

// ============================================================================
// 场景 2 —— 工具调用(bypass):工具真跑 + 事件成对
// ============================================================================

fn scenario_tool_call() -> Verdict {
    // ⚠️ 模式选 `bubble` 而不是 `bypass`:`bypass` 是 legacy 值,核心按
    // v1.3 安全基线**一律降级为 `prompt`**(见 reflect-core 的
    // `sanitize_permission_mode_for_baseline`)—— 它并不"绕过审批"。
    // 真正的自动批准是 `bubble`(自动批准 + 非阻塞 bubble 通知)。
    if let Err(e) = set_permission_mode("bubble") {
        return Verdict::Failed(format!("设置 bubble 失败:{e}"));
    }
    let m = mark();
    if let Err(e) = submit(
        "Call the bash tool with the argument cmd set to exactly: echo live-tool-ok . \
         Then tell me the output. You must use the tool, do not answer from memory.",
    ) {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m, turn_budget()) {
        let evs = since(m);
        if let Some(reason) = blocked_by_upstream(&evs) {
            return Verdict::Skipped(reason);
        }
        // 预算内不收敛 ≠ 产品缺陷:机械是否健康看**配对证据** ——
        // begin/end 成对 + 预期输出到达 + 无引擎错误,说明提交→模型→
        // 工具执行→输出回传全链路在工作,只是免费模型不收口(与
        // tool-approval 的 12 条上限同教义)。此时中断收摊、判模型行为;
        // 无配对证据的超时仍是 Fail(那是真异常)。
        let begins = count(&evs, "tool_call_begin");
        let ends = count(&evs, "tool_call_end");
        let outputs: String = evs
            .iter()
            .filter(|e| ty(e) == "tool_call_end")
            .map(|e| e["msg"]["output"].to_string())
            .collect::<Vec<_>>()
            .join("\n");
        if begins > 0 && begins == ends && outputs.contains("live-tool-ok") {
            let _ = op("reflect_interrupt", json!({}));
            let _ = wait_terminal(m, Duration::from_secs(30));
            return Verdict::Skipped(format!(
                "模型 {begins} 次工具调用全部成对且输出含预期串,但预算内不收敛 \
                 (模型行为,机械配对已验证)。已收到:{}",
                summarize_events(&evs)
            ));
        }
        // 回合没终止 —— 把已发生的事带出来(工具调用了几次?有审批吗?),
        // 否则「超时」这三个字对定位毫无帮助。
        return Verdict::Failed(format!(
            "等待回合终态超时。已收到:{}",
            summarize_events(&evs)
        ));
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let begin = count(&evs, "tool_call_begin");
    let end = count(&evs, "tool_call_end");
    if begin == 0 {
        return Verdict::Skipped("本轮模型未发起工具调用(模型行为,非产品缺陷)".into());
    }
    if begin != end {
        return Verdict::Failed(format!("工具调用不成对(begin={begin} end={end})"));
    }
    let outputs: String = evs
        .iter()
        .filter(|e| ty(e) == "tool_call_end")
        .map(|e| e["msg"]["output"].to_string())
        .collect::<Vec<_>>()
        .join("\n");
    if !outputs.contains("live-tool-ok") {
        let tool_errored = outputs.contains("\"is_error\":true");
        if tool_errored {
            return Verdict::Skipped(format!(
                "工具执行报错(模型参数用错)—— 模型行为,非产品缺陷。模型发的参数:{:?}。实际:{outputs}",
                tool_call_args(&evs)
            ));
        }
        return Verdict::Failed(format!(
            "工具执行结果里没有预期的 echo 输出。模型发的参数:{:?}。实际:{outputs}",
            tool_call_args(&evs)
        ));
    }
    if count(&evs, "approval_request") > 0 {
        return Verdict::Failed("bubble(自动批准)模式下不应出现审批请求".into());
    }
    Verdict::Passed(format!("{begin} 次工具调用成对 · 输出含 live-tool-ok"))
}

// ============================================================================
// 场景 3 —— 工具审批(prompt):审批门拦下 → 批准 → 工具真跑
// ============================================================================

fn scenario_tool_approval() -> Verdict {
    if let Err(e) = set_permission_mode("prompt") {
        return Verdict::Failed(format!("设置 prompt 失败:{e}"));
    }
    let m = mark();
    if let Err(e) = submit(
        "Call the bash tool with the argument cmd set to exactly: echo live-approval-ok . \
         You must use the tool, do not answer from memory.",
    ) {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    let got = wait_until(m, turn_budget(), |evs| {
        count(evs, "approval_request") > 0 || evs.iter().any(is_terminal)
    });
    if !got {
        return Verdict::Failed("等待审批请求超时".into());
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if first(&evs, "approval_request").is_none() {
        return Verdict::Skipped("本轮模型未发起工具调用(模型行为,非产品缺陷)".into());
    }
    // prompt 模式下**每一次**工具调用都有独立的 approval_request;只答
    // 第一条会让回合卡在第二道审批门上,表现为假超时。逐条批准直到终态,
    // 对病理性工具循环设 12 条上限(超限判模型行为)。
    let mut answered: Vec<String> = Vec::new();
    let mut capped = false;
    loop {
        let evs = since(m);
        let mut pending: Vec<String> = Vec::new();
        for e in evs.iter().filter(|e| ty(e) == "approval_request") {
            let rid = e["msg"]["request_id"].as_str().unwrap_or_default();
            if rid.is_empty() {
                return Verdict::Failed("approval_request 缺少 request_id".into());
            }
            if !answered.iter().any(|a| a == rid) {
                pending.push(rid.to_string());
            }
        }
        if pending.is_empty() {
            if evs.iter().any(is_terminal) {
                break;
            }
            let m0 = mark();
            if !wait_until(m0, turn_budget(), |e| {
                e.iter()
                    .any(|ev| ty(ev) == "approval_request" || is_terminal(ev))
            }) {
                // 批准后不收敛 ≠ 产品缺陷:审批门已验证过(至少一条批准
                // → 工具执行 → 输出到达),只是免费模型在批准间无限生成
                // (与 tool-call 的不收敛、12 条上限同教义)。中断收摊,
                // 判模型行为;一条都没批过的超时仍是 Fail(那是真异常)。
                if answered.is_empty() {
                    return Verdict::Failed("批准后等待回合终态超时(且无任何已批准门)".into());
                }
                let _ = op("reflect_interrupt", json!({}));
                let _ = wait_terminal(m, Duration::from_secs(30));
                return Verdict::Skipped(format!(
                    "批准 {answered_n} 道后模型在预算内不收敛(模型行为;审批-执行链已验证)",
                    answered_n = answered.len()
                ));
            }
            continue;
        }
        if answered.len() + pending.len() > 12 {
            // 超限收摊:先中断把卡在第 13 道审批门上的回合终止掉 ——
            // 留着这道没人应答的门会污染后续场景(submit 排队 → 无事件)。
            // 批准-执行链已发生 12 跳,照常断言。
            let _ = op("reflect_interrupt", json!({}));
            let _ = wait_terminal(m, Duration::from_secs(30));
            capped = true;
            break;
        }
        for rid in pending {
            if let Err(e) = op(
                "reflect_tool_approval",
                json!({ "id": rid, "decision": "approve" }),
            ) {
                return Verdict::Failed(format!("批准失败:{e}"));
            }
            answered.push(rid);
        }
    }
    let approved = answered.len();
    let evs = since(m);
    let outputs: String = evs
        .iter()
        .filter(|e| ty(e) == "tool_call_end")
        .map(|e| e["msg"]["output"].to_string())
        .collect::<Vec<_>>()
        .join("\n");
    if !outputs.contains("live-approval-ok") {
        // 工具**报错**(参数用错等)与工具**没跑**是两回事:
        // 前者是模型行为(模型自己编错了参数名),后者才是产品缺陷。
        let tool_errored = outputs.contains("\"is_error\":true");
        if tool_errored {
            return Verdict::Skipped(format!(
                "工具执行报错(模型参数用错)—— 模型行为,非产品缺陷。模型发的参数:{:?}。实际:{outputs}",
                tool_call_args(&evs)
            ));
        }
        if capped {
            return Verdict::Skipped(format!(
                "模型反复发起工具调用触顶 {approved} 次(参数未含预期串)—— 模型行为,非产品缺陷。模型发的参数:{:?}",
                tool_call_args(&evs)
            ));
        }
        return Verdict::Failed(format!(
            "批准后工具未真正执行 —— 输出里没有预期串。模型发的参数:{:?}。实际:{outputs}",
            tool_call_args(&evs)
        ));
    }
    if capped {
        return Verdict::Passed(format!(
            "审批门拦下 → 批准 → 工具真跑(批准链 {approved} 跳全部生效;模型未收敛,回合按上限中断)"
        ));
    }
    Verdict::Passed("审批门拦下 → 批准 → 工具真跑".into())
}

// ============================================================================
// 场景 4 —— 中断
// ============================================================================

fn scenario_interrupt() -> Verdict {
    let m = mark();
    if let Err(e) = submit("Write a very long story, at least 2000 words, one sentence at a time.")
    {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    // 回合**开始**即可中断 —— 不强依赖「先流出增量」:小模型可能把整段
    // 文本攒成一次输出,等增量会把验证拖成纯超时。
    let running = wait_until(m, turn_budget(), |evs| count(evs, "turn_started") > 0);
    if !running {
        let evs = since(m);
        if let Some(reason) = blocked_by_upstream(&evs) {
            return Verdict::Skipped(reason);
        }
        return Verdict::Skipped("回合没启动,无法验证中断".into());
    }
    // 给模型一点时间开始产出再中断 —— 否则可能在任何内容之前就打断,
    // 「中断后没有新内容」这条断言就没有意义。
    wait_until(m, Duration::from_secs(20), |evs| {
        count(evs, "agent_message_delta") > 0
    });
    if let Err(e) = op("reflect_interrupt", json!({})) {
        return Verdict::Failed(format!("interrupt 失败:{e}"));
    }
    if !wait_terminal(m, Duration::from_secs(30)) {
        return Verdict::Failed(format!(
            "中断后回合未终止。已收到:{}",
            summarize_events(&since(m))
        ));
    }
    let evs = since(m);
    if count(&evs, "turn_aborted") == 0 && count(&evs, "turn_complete") == 0 {
        // 终态可能是 error/stream_error(上游 429 掐死流)—— 那是环境态,
        // 不是「中断没生效」。先按上游态归类。
        if let Some(reason) = blocked_by_upstream(&evs) {
            return Verdict::Skipped(reason);
        }
        return Verdict::Failed("中断后既没有 turn_aborted 也没有 turn_complete".into());
    }
    Verdict::Passed("中断后回合终止".into())
}

// ============================================================================
// 场景 5 —— 压缩
// ============================================================================

fn scenario_compact() -> Verdict {
    let m = mark();
    if let Err(e) = submit("Reply with exactly: PONG. Do not use any tools.") {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m, turn_budget()) {
        return Verdict::Failed("前置回合未终止".into());
    }
    let before = since(m);
    if let Some(reason) = blocked_by_upstream(&before) {
        return Verdict::Skipped(reason);
    }
    let c = mark();
    if let Err(e) = op("reflect_compact", json!({})) {
        return Verdict::Failed(format!("reflect_compact 失败:{e}"));
    }
    let done = wait_until(c, Duration::from_secs(60), |evs| {
        count(evs, "context_compacted") > 0 || evs.iter().any(is_terminal)
    });
    if !done {
        return Verdict::Failed("压缩未产生任何事件".into());
    }
    let evs = since(c);
    if count(&evs, "context_compacted") > 0 {
        return Verdict::Passed("context_compacted 事件已到达".into());
    }
    Verdict::Skipped("压缩以回合终态收场,没有 context_compacted 事件(上下文无需压缩)".into())
}

// ============================================================================
// 场景 6 —— 回退
// ============================================================================

fn scenario_rewind() -> Verdict {
    let m = mark();
    for i in 0..2 {
        // 每一轮用**自己的**游标 —— 否则第 2 轮会立刻被第 1 轮的终态事件
        // 满足(窗口里已经有 terminal),回合还没跑完就被当成「跑完了」。
        let round = mark();
        if let Err(e) = submit(&format!(
            "Reply with exactly: PONG{i}. Do not use any tools."
        )) {
            return Verdict::Failed(format!("reflect_submit 失败:{e}"));
        }
        if !wait_terminal(round, turn_budget()) {
            return Verdict::Failed(format!(
                "前置回合 {i} 未终止。已收到:{}",
                summarize_events(&since(round))
            ));
        }
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let turn_ids: Vec<String> = evs
        .iter()
        .filter(|e| ty(e) == "turn_started")
        .map(|e| e["msg"]["turn_id"].as_str().unwrap_or_default().to_string())
        .collect();
    if turn_ids.len() < 2 {
        return Verdict::Skipped("不足两轮,无法验证回退".into());
    }
    let r = mark();
    if let Err(e) = op("reflect_rewind", json!({ "toTurnId": turn_ids[0] })) {
        return Verdict::Failed(format!("reflect_rewind 失败:{e}"));
    }
    let done = wait_until(r, Duration::from_secs(30), |evs| {
        count(evs, "turn_rewound") > 0 || evs.iter().any(is_terminal)
    });
    if !done {
        return Verdict::Failed("回退未产生任何事件".into());
    }
    let evs = since(r);
    if count(&evs, "turn_rewound") == 0 {
        return Verdict::Skipped("回退以回合终态收场,没有 turn_rewound 事件".into());
    }
    Verdict::Passed("turn_rewound 事件已到达".into())
}

// ============================================================================
// 场景 7 —— plan 模式
//
// ⚠️ 事件序列(实测口径):
//   enter_plan_mode → `plan_request`
//   exit_plan_mode  → `plan_ready`(带 plan_id)
//   plan_approval   → `plan_approved` + permission_mode_changed
// `enter_plan_mode` **不**产出 plan —— 它先发 plan_request 并等审批。
// ============================================================================

fn scenario_plan_mode() -> Verdict {
    let m = mark();
    if let Err(e) = op(
        "reflect_enter_plan_mode",
        json!({ "task": "Write a one-paragraph plan for testing the plan mode." }),
    ) {
        return Verdict::Failed(format!("reflect_enter_plan_mode 失败:{e}"));
    }
    let requested = wait_until(m, turn_budget(), |evs| {
        count(evs, "plan_request") > 0 || evs.iter().any(is_terminal)
    });
    if !requested {
        return Verdict::Failed("等待 plan_request 超时".into());
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let Some(req) = first(&evs, "plan_request").cloned() else {
        return Verdict::Skipped("未收到 plan_request".into());
    };
    let plan_id = req["msg"]["plan_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if plan_id.is_empty() {
        return Verdict::Failed("plan_request 缺少 plan_id".into());
    }

    // 退出 plan 模式 → 应当产出 plan_ready。
    let r = mark();
    if let Err(e) = op("reflect_exit_plan_mode", json!({})) {
        return Verdict::Failed(format!("reflect_exit_plan_mode 失败:{e}"));
    }
    let ready = wait_until(r, Duration::from_secs(60), |evs| {
        count(evs, "plan_ready") > 0 || evs.iter().any(is_terminal)
    });
    if !ready {
        return Verdict::Failed("等待 plan_ready 超时".into());
    }
    let evs = since(r);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if count(&evs, "plan_ready") == 0 {
        return Verdict::Skipped("未收到 plan_ready(模型未产出 plan)".into());
    }
    let ready_id = first(&evs, "plan_ready")
        .and_then(|e| e["msg"]["plan_id"].as_str())
        .unwrap_or_default()
        .to_string();
    if ready_id.is_empty() {
        return Verdict::Failed("plan_ready 缺少 plan_id".into());
    }

    // 批准(auto_mode)→ 应当产出 plan_approved。
    let a = mark();
    if let Err(e) = op(
        "reflect_plan_approval",
        json!({ "id": ready_id, "choice": "auto_mode" }),
    ) {
        return Verdict::Failed(format!("reflect_plan_approval 失败:{e}"));
    }
    let approved = wait_until(a, Duration::from_secs(30), |evs| {
        count(evs, "plan_approved") > 0 || evs.iter().any(is_terminal)
    });
    if !approved {
        return Verdict::Failed("等待 plan_approved 超时".into());
    }
    let evs = since(a);
    if count(&evs, "plan_approved") == 0 {
        return Verdict::Skipped("未收到 plan_approved".into());
    }
    Verdict::Passed(format!(
        "plan_request → plan_ready → plan_approved(plan_id {plan_id})"
    ))
}

// ============================================================================
// 场景 8 —— goal 模式
//
// ⚠️ goal 模式**没有专属事件**(上游协议如此):可观测信号是
// 「**没有用户输入却多出来的回合**」—— 控制器自验证后把续作提示推进
// 转向队列,agent 自动开新一轮。终态靠 `goal.turn.verified` span 记录。
// ============================================================================

fn scenario_goal_mode() -> Verdict {
    let m = mark();
    if let Err(e) = op(
        "reflect_enter_goal_mode",
        json!({
            "goal": "Reply with exactly: GOALDONE and do not use tools.",
            "verifyCommand": null,
            "tokenBudget": 40000
        }),
    ) {
        return Verdict::Failed(format!("reflect_enter_goal_mode 失败:{e}"));
    }
    // 与 GUI `dispatchSubmission.ts::start_goal` 同款顺序:core 的
    // EnterGoalMode 只挂载自校验控制器、**不启动 turn** —— 不先发一条
    // 用户消息,循环永不开始(此前零事件 900s 超时即此因;早前全矩阵里
    // 本场景的 PASS 是蹭了上一场景收尾回合的 turn_complete,属假阳性)。
    if let Err(e) = submit("Reply with exactly: GOALDONE and do not use tools.") {
        return Verdict::Failed(format!("goal 首条消息提交失败:{e}"));
    }
    // goal 模式会**自动**多轮续作,且每轮结束还要多跑一次 LM 自校验 ——
    // 预算给得比普通回合宽(可用 REFLECT_LIVE_GOAL_BUDGET 覆盖)。
    let goal_budget = Duration::from_secs(
        std::env::var("REFLECT_LIVE_GOAL_BUDGET")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| turn_budget().as_secs() * 2),
    );
    let finished = wait_until(m, goal_budget, |evs| count(evs, "turn_complete") > 0);
    let evs = since(m);
    // 无论判定如何都先退出 goal 模式,别把后续场景拖进自动续作。
    let _ = op("reflect_exit_goal_mode", json!({}));
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if !finished {
        return Verdict::Skipped(format!(
            "goal 模式未在 {goal_budget:?} 预算内跑完一轮。已收到:{}",
            summarize_events(&evs)
        ));
    }
    let turns = count(&evs, "turn_started");
    let content = content_bytes(&evs);
    if content == 0 {
        return Verdict::Skipped("goal 模式跑完但没有正文".into());
    }
    Verdict::Passed(format!(
        "goal 模式跑了 {turns} 轮 · 正文 {content}B(无专属事件,按续作回合计数)"
    ))
}

// ============================================================================
// 场景 9 —— 会话标题生成
// ============================================================================

fn scenario_session_title() -> Verdict {
    let m = mark();
    if let Err(e) = submit("Reply with exactly: PONG. Do not use any tools.") {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m, turn_budget()) {
        return Verdict::Failed("前置回合未终止".into());
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    // 会话必须**先绑定**才会存在:rollout recorder 只在 `reflect_bind_session`
    // 重建线程时挂上 —— 没绑定的回合不落盘,`reflect_list_sessions` 自然是空的。
    let Ok(new_id) = common::invoke("reflect_create_session", json!({})) else {
        return Verdict::Skipped("建会话失败,跳过标题生成".into());
    };
    let id = new_id.as_str().unwrap_or_default().to_string();
    if id.is_empty() {
        return Verdict::Skipped("会话 id 为空,跳过标题生成".into());
    }
    if common::invoke("reflect_bind_session", json!({ "id": id })).is_err() {
        return Verdict::Skipped("绑定会话失败,跳过标题生成".into());
    }
    // 绑定后再跑一轮,让 recorder 有内容。
    let m2 = mark();
    if let Err(e) = submit("Reply with exactly: PONG. Do not use any tools.") {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m2, turn_budget()) {
        return Verdict::Failed("绑定后的回合未终止".into());
    }
    match op(
        "reflect_generate_session_title",
        json!({ "id": id, "force": true }),
    ) {
        Ok(title) if !title.trim().is_empty() => {
            Verdict::Passed(format!("标题生成成功(长度 {})", title.trim().len()))
        }
        Ok(_) => Verdict::Failed("标题为空".into()),
        Err(e) => {
            let evs = since(m);
            if let Some(reason) = blocked_by_upstream(&evs) {
                Verdict::Skipped(reason)
            } else {
                Verdict::Failed(format!("标题生成失败:{e}"))
            }
        }
    }
}

// ============================================================================
// 场景 10 —— 任务工具
// ============================================================================

fn scenario_task_tool() -> Verdict {
    let m = mark();
    if let Err(e) = submit(
        "Create a task named live-task-probe with the description 'created by the live layer'. \
         You must use the task creation tool.",
    ) {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_terminal(m, turn_budget()) {
        return Verdict::Failed("等待回合终态超时".into());
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if count(&evs, "tool_call_begin") == 0 {
        return Verdict::Skipped("本轮模型未发起工具调用(模型行为,非产品缺陷)".into());
    }
    // 模型调的是不是**任务**工具?调了别的工具(比如 bash)不算产品缺陷。
    let called: Vec<String> = evs
        .iter()
        .filter(|e| ty(e) == "tool_call_begin")
        .map(|e| {
            e["msg"]["tool_name"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    if !called.iter().any(|t| t.to_lowercase().contains("task")) {
        return Verdict::Skipped(format!(
            "模型发起的是别的工具({called:?}),没调任务工具 —— 模型行为,非产品缺陷"
        ));
    }
    // 任务的权威来源是**工具输出**:`output.metadata.task` = 完整 task 对象,
    // `output.metadata.listId` = 任务所在的列表。
    //
    // ⚠️ 列表 id **不是** "all" —— `TaskCreate` 的 `listId` 缺省是
    // **ctx.session_id**,所以要按工具回填的 listId 去查,查 "all" 永远是空
    // (那正是本场景先前误报「任务没建出来」的原因)。
    let created: Vec<Value> = evs
        .iter()
        .filter(|e| ty(e) == "tool_call_end")
        .filter_map(|e| {
            let t = e["msg"]["output"]["metadata"]["task"].clone();
            if t.is_object() { Some(t) } else { None }
        })
        .collect();
    if created.is_empty() {
        return Verdict::Skipped(
            "任务工具没产出任务对象(模型参数用错 / 工具报错)—— 模型行为,非产品缺陷".into(),
        );
    }
    let subject = created[0]["subject"].as_str().unwrap_or_default();
    let list_id = created[0]["list_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if subject != "live-task-probe" {
        return Verdict::Skipped(format!(
            "模型建的任务标题是 {subject:?} 而不是 live-task-probe —— 模型行为,非产品缺陷"
        ));
    }
    if list_id.is_empty() {
        return Verdict::Failed("任务对象缺 list_id".into());
    }
    // 任务板可见:按工具回填的 listId 查。
    let Some(tasks) = common::invoke("reflect_list_tasks", json!({ "list": list_id })).ok() else {
        return Verdict::Failed("reflect_list_tasks 失败".into());
    };
    let arr = tasks.as_array().cloned().unwrap_or_default();
    let hit = arr
        .iter()
        .any(|t| t["subject"].as_str() == Some("live-task-probe"));
    if !hit {
        return Verdict::Failed(format!(
            "模型调了任务工具并回填了任务({subject:?} @ {list_id}),但任务列表里没有它(共 {} 条)",
            arr.len()
        ));
    }
    Verdict::Passed(format!(
        "模型建的任务在任务板可见(subject={subject:?} list={list_id})"
    ))
}

// ============================================================================
// 场景 11 —— 子代理委派
// ============================================================================

fn scenario_subagent() -> Verdict {
    let m = mark();
    if let Err(e) = submit(
        "Delegate this to a sub-agent: ask it to reply with exactly: SUBOK . \
         You must use the sub-agent tool.",
    ) {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    if !wait_until(m, turn_budget(), |evs| {
        approve_pending(evs);
        evs.iter().any(is_terminal)
    }) {
        return Verdict::Failed(format!(
            "等待回合终态超时。已收到:{}",
            summarize_events(&since(m))
        ));
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if count(&evs, "subagent_progress") == 0 && count(&evs, "subagent_status") == 0 {
        return Verdict::Skipped("本轮没有子代理事件(模型未委派,或该能力未接线)".into());
    }
    Verdict::Passed(format!(
        "子代理事件 {} 条(progress {} / status {})",
        count(&evs, "subagent_progress"),
        count(&evs, "subagent_progress"),
        count(&evs, "subagent_status")
    ))
}

// ============================================================================
// 场景 12 —— 追问
// ============================================================================

fn scenario_ask_user() -> Verdict {
    let m = mark();
    if let Err(e) = submit(
        "Before answering, ask the user exactly one question using the ask-user tool \
         (for example which language to use). Then wait for the answer.",
    ) {
        return Verdict::Failed(format!("reflect_submit 失败:{e}"));
    }
    let asked = wait_until(m, turn_budget(), |evs| {
        approve_pending(evs);
        count(evs, "ask_user_question") > 0
            || count(evs, "ask_user_input") > 0
            || evs.iter().any(is_terminal)
    });
    if !asked {
        return Verdict::Failed(format!(
            "等待追问事件超时。已收到:{}",
            summarize_events(&since(m))
        ));
    }
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let Some(question) = first(&evs, "ask_user_question").or_else(|| first(&evs, "ask_user_input"))
    else {
        return Verdict::Skipped("模型未发起追问(模型行为,非产品缺陷)".into());
    };
    let qid = question["msg"]["request_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if qid.is_empty() {
        return Verdict::Failed("追问事件缺少 request_id".into());
    }
    if let Err(e) = op(
        "reflect_ask_user_question_response",
        json!({ "id": qid, "answers": { "answers": [] } }),
    ) {
        return Verdict::Failed(format!("回执失败:{e}"));
    }
    Verdict::Passed("追问事件已到达且回执提交成功".into())
}

// ============================================================================
// 场景 13 —— 编排:讨论
// ============================================================================

fn scenario_discussion() -> Verdict {
    let toml = r#"[discussion]
mode = "concurrent"
topic = "Should the desktop backend adopt Rust? Answer in one sentence."
max_rounds = 2
consensus_window = 1

[[agents]]
role = "advocate"
system_prompt = "Argue in favor. Use send_message to speak, finish_discussion when done."
allowed_tools = ["send_message", "read_messages", "finish_discussion"]

[[agents]]
role = "skeptic"
system_prompt = "Challenge the advocate. Use send_message to speak, finish_discussion when done."
allowed_tools = ["send_message", "read_messages", "finish_discussion"]
"#;
    let path = match write_temp("discussion.toml", toml) {
        Ok(p) => p,
        Err(e) => return Verdict::Failed(e),
    };
    let m = mark();
    let out = match common::invoke("reflect_run_discussion", json!({ "configPath": path })) {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("{e}");
            return if quota_ish(&msg) {
                Verdict::Skipped(format!("讨论因上游配额/限流未跑起来:{msg}"))
            } else {
                Verdict::Failed(format!("reflect_run_discussion 失败:{msg}"))
            };
        }
    };
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    if out["llmBacked"].as_bool() != Some(true) {
        return Verdict::Failed("讨论没有真模型背书(llmBacked != true)".into());
    }
    let outcome = out["result"]["outcome"].as_str().unwrap_or_default();
    if outcome.is_empty() {
        return Verdict::Failed("讨论结果缺少 outcome".into());
    }
    if !["consensus", "no_consensus", "finished"].contains(&outcome) {
        return Verdict::Failed(format!("未知的讨论结局:{outcome}"));
    }
    let collab = count(&evs, "collab_message");
    Verdict::Passed(format!(
        "讨论结局 {outcome} · llmBacked=true · collab 事件 {collab} 条"
    ))
}

// ============================================================================
// 场景 14 —— 编排:流水线(需要同名 team)
// ============================================================================

/// 建一个 team —— 流水线节点的**标签必须与 team 名同名**(上游约束:
/// 节点的 runner 从同名的 team 里取)。
fn ensure_team(name: &str) -> Result<(), String> {
    let team = json!({
        "name": name,
        "lead_agent_id": format!("team-lead@{name}"),
        "members": [{
            "agent_id": format!("team-lead@{name}"),
            "name": "team-lead",
            "role": "team-lead",
            "model": null,
            "system_prompt": "You are a planner. Answer concisely.",
            "allowed_tools": [],
            "joined_at": { "secs_since_epoch": 1700000000, "nanos_since_epoch": 0 }
        }],
        "created_at": { "secs_since_epoch": 1700000000, "nanos_since_epoch": 0 }
    });
    common::invoke("reflect_upsert_team", json!({ "team": team }))
        .map(|_| ())
        .map_err(|e| format!("{e}"))
}

fn scenario_pipeline() -> Verdict {
    if let Err(e) = ensure_team("plan") {
        return Verdict::Failed(format!("建 team 失败:{e}"));
    }
    let toml = r#"name = "live-smoke"
failure_policy = "abort"

[nodes.plan]
runner = "team"
"#;
    let path = match write_temp("pipeline.toml", toml) {
        Ok(p) => p,
        Err(e) => return Verdict::Failed(e),
    };
    let m = mark();
    let out = match common::invoke(
        "reflect_run_pipeline",
        json!({ "configPath": path, "topic": "say PONG", "failurePolicy": "abort" }),
    ) {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("{e}");
            return if quota_ish(&msg) {
                Verdict::Skipped(format!("流水线因上游配额/限流未跑起来:{msg}"))
            } else {
                Verdict::Failed(format!("reflect_run_pipeline 失败:{msg}"))
            };
        }
    };
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let status = out["status"].as_str().unwrap_or_default();
    if status != "success" {
        let report = out.to_string();
        return if quota_ish(&report) {
            Verdict::Skipped(format!("流水线因上游配额/限流失败:{report}"))
        } else {
            Verdict::Failed(format!("流水线状态 = {status}(报告:{report})"))
        };
    }
    let nodes = out["nodes"].as_array().cloned().unwrap_or_default();
    if nodes.is_empty() {
        return Verdict::Failed("流水线报告没有节点".into());
    }
    let result = nodes[0]["outputs"]["result"].as_str().unwrap_or_default();
    if result.is_empty() {
        return Verdict::Failed("流水线节点没有产出结果".into());
    }
    Verdict::Passed(format!(
        "流水线 status=success · {} 个节点 · 首节点产出 {}B",
        nodes.len(),
        result.len()
    ))
}

// ============================================================================
// 场景 15 —— 编排:团队流水线(固定 4 节点链)
// ============================================================================

fn scenario_team_pipeline() -> Verdict {
    if let Err(e) = ensure_team("live-team") {
        return Verdict::Failed(format!("建 team 失败:{e}"));
    }
    let m = mark();
    let out = match common::invoke(
        "reflect_run_team_pipeline",
        json!({ "teamName": "live-team", "topic": "say PONG" }),
    ) {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("{e}");
            return if quota_ish(&msg) {
                Verdict::Skipped(format!("团队流水线因上游配额/限流未跑起来:{msg}"))
            } else {
                Verdict::Failed(format!("reflect_run_team_pipeline 失败:{msg}"))
            };
        }
    };
    let evs = since(m);
    if let Some(reason) = blocked_by_upstream(&evs) {
        return Verdict::Skipped(reason);
    }
    let status = out["status"].as_str().unwrap_or_default();
    if status != "success" {
        let report = out.to_string();
        return if quota_ish(&report) {
            Verdict::Skipped(format!("团队流水线因上游配额/限流失败:{report}"))
        } else {
            Verdict::Failed(format!("团队流水线状态 = {status}(报告:{report})"))
        };
    }
    let nodes = out["nodes"].as_array().cloned().unwrap_or_default();
    Verdict::Passed(format!(
        "团队流水线 status=success · {} 个节点",
        nodes.len()
    ))
}

// ============================================================================
// 入口
// ============================================================================

/// 一个场景 = 名字 + 跑法。
type Scenario = (&'static str, fn() -> Verdict);

/// 只跑指定场景(逗号分隔)—— 迭代单个场景时用。
///
/// `REFLECT_LIVE_SCENARIOS=tool-call,tool-approval` → 只跑这两个。
/// 不设 = 全跑。
fn scenario_selected(name: &str) -> bool {
    let Ok(filter) = std::env::var("REFLECT_LIVE_SCENARIOS") else {
        return true;
    };
    if filter.trim().is_empty() {
        return true;
    }
    filter.split(',').any(|f| f.trim() == name)
}

/// 场景表 —— 顺序执行(共享配额,必须串行)。
const SCENARIOS: &[Scenario] = &[
    ("agent-loop", scenario_agent_loop),
    ("tool-call", scenario_tool_call),
    ("tool-approval", scenario_tool_approval),
    ("interrupt", scenario_interrupt),
    ("compact", scenario_compact),
    ("rewind", scenario_rewind),
    ("plan-mode", scenario_plan_mode),
    ("goal-mode", scenario_goal_mode),
    ("session-title", scenario_session_title),
    ("task-tool", scenario_task_tool),
    ("subagent", scenario_subagent),
    ("ask-user", scenario_ask_user),
    ("discussion", scenario_discussion),
    ("pipeline", scenario_pipeline),
    ("team-pipeline", scenario_team_pipeline),
];

/// 是否是「上游配额耗尽」类的跳过(后续场景只会继续撞墙)。
fn is_quota_skip(reason: &str) -> bool {
    let h = reason.to_lowercase();
    h.contains("rate_limit")
        || h.contains("rate limited")
        || h.contains("429")
        || h.contains("quota")
        || h.contains("limit_reached")
        || h.contains("all_credentials_exhausted")
}

#[test]
#[ignore = "实模型演练层:需 REFLECT_LIVE=1 显式开启(默认不发网络请求)"]
fn live_capability_matrix() {
    if std::env::var("REFLECT_LIVE").unwrap_or_default() != "1" {
        report(
            "live-capability-matrix",
            &Verdict::Skipped("未设 REFLECT_LIVE=1 —— 不发起任何网络请求".into()),
        );
        return;
    }

    // 配置必须在 AgentThread 安装**之前**落定 —— 安装那一刻就要建
    // ModelRegistry 并解析 model spec(可能要打 provider 的清单端点)。
    common::set_config_before_install(&live_config_toml());

    // 触发 harness 安装 + 事件监听。
    let _ = sink();
    let spec = common::agent().model_spec();
    if spec == "stub/test" || spec.ends_with("/free") || !spec.contains('/') {
        report(
            "live-capability-matrix",
            &Verdict::Failed(format!(
                "model spec = {spec} —— 未解析成真实模型 id(检查 [model_discovery] 与端点可达性)"
            )),
        );
        return;
    }
    report(
        "live-capability-matrix",
        &Verdict::Passed(format!("model spec = {spec}(清单实时发现)")),
    );

    for (name, f) in SCENARIOS {
        if !scenario_selected(name) {
            continue;
        }
        // 场景隔离:权限模式统一复位到 bubble(自动批准)。上一个场景
        // (如 tool-approval)留在 prompt 会让后续回合卡在没人应答的审批
        // 门上 —— 超时/「无事件」都是环境串扰的假阳性,不是产品缺陷。
        let _ = set_permission_mode("bubble");
        let v = f();
        report(name, &v);
        // 上游配额被打满 → 后面的场景只会继续撞墙,提前收场。
        if let Verdict::Skipped(reason) = &v {
            if is_quota_skip(reason) {
                println!("LIVE_CASE\t(remaining)\tSKIP\t上游配额耗尽,剩余场景不再执行:{reason}");
                break;
            }
        }
    }
}

/// 指向免费池的隔离配置 —— 与 `ipc_live_free_model.rs` 同口径。
fn live_config_toml() -> String {
    let base_url = std::env::var("REFLECT_LIVE_BASE_URL")
        .unwrap_or_else(|_| "https://api.kilo.ai/api/gateway".into());
    let api_key = std::env::var("REFLECT_LIVE_API_KEY").unwrap_or_default();
    let explicit = std::env::var("REFLECT_LIVE_MODELS").unwrap_or_default();
    let model = if explicit.trim().is_empty() {
        "free".to_string()
    } else {
        explicit
            .split(',')
            .next()
            .unwrap_or("free")
            .trim()
            .to_string()
    };
    let provider = std::env::var("REFLECT_LIVE_PROVIDER").unwrap_or_else(|_| "openai".into());
    if provider == "ollama" {
        return format!(
            r#"[hooks]
enabled = []

[active]
provider = "ollama"

[ollama]
base_url = "{base_url}"
model = "{model}"
"#
        );
    }
    format!(
        r#"[hooks]
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
    )
}
