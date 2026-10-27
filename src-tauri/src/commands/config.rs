//! Config + tool registry 命令。

use serde::Serialize;
use tauri::State;

use reflect_config::{default_config_path, load_from_str};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::{AgentStatus, MinimalAgent};

/// 返回 agent 状态快照(ready / has_model / model / workspace / degraded_reason)。
/// 前端用来显示状态徽标 + 引导用户去 Settings 配 API key。
#[tauri::command]
pub async fn reflect_agent_status(agent: State<'_, MinimalAgent>) -> CommandResult<AgentStatus> {
    Ok(agent.agent_status())
}

/// 返回当前 `~/.reflect/config.toml` 的 TOML 字符串。Settings 页加载用。
#[tauri::command]
pub async fn reflect_get_config(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    let cfg = agent.cfg();
    let toml = toml::to_string_pretty(&*cfg.read()).map_err(|e| CommandError {
        msg: format!("serialize config: {e}"),
    })?;
    Ok(toml)
}

/// 新配置写盘 + 热替换共享 cfg(校验由调用方完成)。返回旧快照供调用方
/// 做变更检测(`hot_reload_provider_stack` 需要 old/new 对比)。
///
/// `pub(crate)`:MCP 管理命令也要走同一条落盘路径(改 `[mcp_servers]` 后
/// 落盘 + 换内存快照),避免各自拼一套写盘逻辑。
pub(crate) fn persist_config(
    agent: &MinimalAgent,
    new_cfg: reflect_config::ReflectConfig,
) -> CommandResult<reflect_config::ReflectConfig> {
    let toml = toml::to_string_pretty(&new_cfg).map_err(|e| CommandError {
        msg: format!("serialize config: {e}"),
    })?;
    let path = default_config_path().ok_or_else(|| CommandError {
        msg: "no HOME dir for config".into(),
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &toml)?;
    let old_cfg = {
        let cfg_arc = agent.cfg();
        let mut guard = cfg_arc.write();
        std::mem::replace(&mut *guard, new_cfg)
    };
    tracing::info!(
        "[reflect-gui] config saved to {} (hot-reloaded in-memory)",
        path.display()
    );
    Ok(old_cfg)
}

/// 写回 `~/.reflect/config.toml`。写盘前用 `load_from_str` 校验合法性,
/// 防止坏 TOML 损坏配置;校验通过才覆盖,并热更新共享 cfg。
///
/// provider 相关段(`active` / `anthropic` / `openai` / `ollama` / `routing`)
/// 变化时,进一步重建 ModelRegistry + QuotaTracker 并强制重绑当前会话
/// (见 `state/reload.rs`)—— coding plan 的新增/切换**无需重启**即对
/// 运行中的会话生效。其余段落(MCP、hooks、显示等)仍只热更新 cfg,
/// 由各自的重载机制接管。
#[tauri::command]
pub async fn reflect_save_config(
    agent: State<'_, MinimalAgent>,
    toml: String,
) -> CommandResult<()> {
    // 1. 校验:能否解析回 ReflectConfig。
    let mut new_cfg = load_from_str(&toml)?;
    // 1.5 `[sandbox].os_level` 归一:核心 schema 是 `Option<bool>`,解析后
    //     即可区分「没写」(None)与「写了 false」(Some(false))。没写
    //     → 走核心基线(默认要求 OS sandbox),不因一次保存把沙箱静默关掉;
    //     显式写了 → 尊重用户的显式表态。归一后恒为 Some(有效值)。
    new_cfg.sandbox.os_level = Some(reflect_app_core::sandbox::normalize_os_level(
        new_cfg.sandbox.os_level,
    ));
    // 2. 写盘 + 热更新共享 cfg(保留旧快照供变更检测)。
    let old_cfg = persist_config(&agent, new_cfg.clone())?;
    // 3. provider 栈变化 → 重建 registry/tracker + 重绑当前会话。
    //    模型解析失败(`model = "free"` 这类动态值挑不到模型)时,配置**已
    //    写盘**(保存本身成功),失败原因进 `agent_status.degraded_reason`
    //    —— 状态栏黄点可见。这里不把保存报成失败(那会误导用户重试)。
    if let Some(err) =
        crate::state::reload::hot_reload_provider_stack(&agent, &old_cfg, &new_cfg).await
    {
        tracing::warn!("[reflect-gui] model spec resolution failed after save: {err}");
    }
    Ok(())
}

/// 运行中切换模型 / 钉住 coding plan(spec = `{provider}/{model}`)。
///
/// 协议 `Op` 没有 SetModel —— 模型 spec 在配置层解析
/// (`resolved_model_spec()` = env > 被钉住条目 model > 段级 model),
/// 因此走与 ModelsView 切 coding plan 相同的路径:改 `[active].provider`
/// + `[active].credential` + 条目/段级 model → 写盘 →
/// `hot_reload_provider_stack`(重建 registry + 强制重绑当前会话),
/// 下一个 turn 立即生效。
///
/// `label` = 要钉住的 plan(`[[<provider>.credentials]]` 的 label):
/// - `Some(非空)`:写入 `[active].credential`;model 写入该条目自身的
///   `model` 字段(与前端 plan 编辑器同源,条目 model 优先于段级)。
///   条目不存在时报错,防止钉住指向空处静默失效。
/// - `None`/空串:不钉住(清除 `[active].credential`),model 写段级
///   `[<provider>].model`。
///
/// `model` 传空串 = 清除对应位置的 model 覆盖。返回解析后的完整 spec;
/// 无任何显式 model 时返回空串(诚实缺失,由 UI 显示"未配置模型")。
#[tauri::command]
pub async fn reflect_set_model(
    agent: State<'_, MinimalAgent>,
    provider: String,
    model: String,
    label: Option<String>,
) -> CommandResult<String> {
    if !matches!(provider.as_str(), "anthropic" | "openai" | "ollama") {
        return Err(CommandError {
            msg: format!("unknown provider: {provider} (expected anthropic | openai | ollama)"),
        });
    }
    let mut new_cfg = agent.cfg().read().clone();
    apply_model_switch(&mut new_cfg, &provider, &model, label.as_deref())?;
    let old_cfg = persist_config(&agent, new_cfg.clone())?;
    // 模型解析失败(`model = "free"` 这类动态值挑不到模型)→ 如实报错给
    // 前端(配置已写盘,但请求会用不了这个模型)。
    if let Some(err) =
        crate::state::reload::hot_reload_provider_stack(&agent, &old_cfg, &new_cfg).await
    {
        return Err(CommandError {
            msg: format!("model spec resolution failed: {err}"),
        });
    }
    // 返回**已解析**的 spec —— `model = "free"` 这类动态值在热重载阶段已
    // 解析成真实 id(不是占位串 `"provider/free"`)。没配 model 时返回空串
    // (诚实缺失,由 UI 显示"未配置模型")。
    let spec = match agent.model_spec().as_str() {
        "stub/test" => String::new(),
        s => s.to_string(),
    };
    tracing::info!("[reflect-gui] model switched to '{spec}' (hot-reloaded)");
    Ok(spec)
}

/// `reflect_set_model` 的纯函数核心(便于无 Tauri State 单测)。
fn apply_model_switch(
    cfg: &mut reflect_config::ReflectConfig,
    provider: &str,
    model: &str,
    label: Option<&str>,
) -> CommandResult<()> {
    cfg.active.provider = Some(provider.to_string());
    let label = label.map(str::trim).filter(|l| !l.is_empty());
    cfg.active.credential = label.map(str::to_string);
    let model_opt = (!model.trim().is_empty()).then(|| model.trim().to_string());
    match provider {
        "anthropic" => {
            let s = cfg.anthropic.get_or_insert_with(Default::default);
            apply_section_model(&mut s.credentials, &mut s.model, label, model_opt)
        }
        "openai" => {
            let s = cfg.openai.get_or_insert_with(Default::default);
            apply_section_model(&mut s.credentials, &mut s.model, label, model_opt)
        }
        "ollama" => {
            let s = cfg.ollama.get_or_insert_with(Default::default);
            apply_section_model(&mut s.credentials, &mut s.model, label, model_opt)
        }
        _ => unreachable!("provider validated by caller"),
    }
}

/// 把 model 写到正确的层级:钉住条目(`label` 命中 credentials)写条目
/// 自身;顶层隐式 plan(label = "default" 无数组条目)或未传 label 写段级。
/// 显式钉住却找不到条目 → 报错,避免 `[active].credential` 指向空处静默失效。
fn apply_section_model(
    credentials: &mut [reflect_config::CredentialConfig],
    section_model: &mut Option<String>,
    label: Option<&str>,
    model_opt: Option<String>,
) -> CommandResult<()> {
    if let Some(entry) = label.and_then(|l| credentials.iter_mut().find(|c| c.label == l)) {
        entry.model = model_opt;
        return Ok(());
    }
    if let Some(l) = label {
        if l != "default" {
            return Err(CommandError {
                msg: format!("credential label '{l}' not found in credentials"),
            });
        }
        // "default" = 顶层 `[provider].api_key` 隐式 plan(无数组条目):
        // builder 把它 wrap 成 label="default" 的池条目,钉住依然成立,
        // model 走段级。
    }
    *section_model = model_opt;
    Ok(())
}

/// 列出当前 ToolRegistry 中所有工具(name + description)。
/// 前端 Settings / Skills 页展示可用工具列表用。
#[tauri::command]
pub async fn reflect_list_tools(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<ToolInfo>> {
    let tools = agent.tools();
    let mut out: Vec<ToolInfo> = tools
        .list()
        .into_iter()
        .filter_map(|name| {
            let t = tools.get(&name)?;
            Some(ToolInfo {
                name,
                description: t.description().to_string(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 单个工具的 name + description。
#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
}

// ── Coding plan 余量查询 ─────────────────────────────────────────

/// coding plan 余量快照(序列化给前端)。字段对齐 `reflect_llm::QuotaSnapshot`,
/// 仅把 `resets_at` 从 `DateTime<Utc>` 转成 RFC3339 字符串。
#[derive(Debug, Clone, Serialize)]
pub struct PlanQuotaSnapshot {
    /// 查询是否成功。`false` = 鉴权/解析等确定性失败(或网络瞬时失败),
    /// 原因见 `error`。
    pub success: bool,
    pub error: Option<String>,
    /// 主窗口已用百分比 0-100(厂商未返回为 null)。
    pub utilization: Option<f64>,
    /// 剩余 token 绝对值(Kimi 等直接给 remaining;百分比型厂商为 null)。
    pub remaining_tokens: Option<u64>,
    /// 窗口上限 token 绝对值。
    pub max_tokens: Option<u64>,
    /// 窗口重置时间(RFC3339;厂商未返回为 null)。
    pub resets_at: Option<String>,
}

/// 把 `check_via` 字符串(`kimi | zhipu | minimax | zenmux | …`,与
/// `reflect_config::QuotaSource` 的 snake_case 序列化一致)解析成 provider 实例。
/// 复用 `state::quota::make_provider` 的同一份映射;`None`(火山/Anthropic/
/// OpenAI usage 暂未实现)报错给前端,而非静默走本地统计。
fn make_quota_provider(
    check_via: &str,
) -> Result<std::sync::Arc<dyn reflect_llm::QuotaProvider>, CommandError> {
    if check_via.is_empty() {
        return Err(CommandError {
            msg: "check_via is empty — set quota.check_via on the plan first".into(),
        });
    }
    let src: reflect_config::QuotaSource =
        serde_json::from_value(serde_json::Value::String(check_via.to_string())).map_err(|_| {
            CommandError {
                msg: format!("unknown check_via: {check_via}"),
            }
        })?;
    crate::state::quota::make_provider(&src).ok_or_else(|| CommandError {
        msg: format!(
            "quota query via '{check_via}' is not implemented yet (volcengine needs AK/SK signing; \
             anthropic_usage / open_a_i_usage need OAuth credentials)"
        ),
    })
}

/// 查询指定 coding plan 的剩余额度(对着厂商用量 API,端点与 cc-switch 一致:
/// Kimi `/coding/v1/usages`、智谱 `/api/monitor/usage/quota/limit`、
/// MiniMax `/coding_plan/remains`、ZenMux base_url)。查询本体在
/// `reflect_llm` 的 `QuotaProvider` 实现里,与运行时 failover 判定共用。
///
/// 传显式 `base_url` / `api_key` 而非 (provider, label):前端编辑中的未保存
/// 表单也能直接试查,无需先落盘。网络瞬时失败同样折叠为
/// `success=false`——对手动查询而言展示层处理方式相同。
#[tauri::command]
pub async fn reflect_query_plan_quota(
    base_url: String,
    api_key: String,
    check_via: String,
) -> CommandResult<PlanQuotaSnapshot> {
    let provider = make_quota_provider(&check_via)?;
    let snapshot = match provider.query(&base_url, &api_key).await {
        Ok(s) => s,
        Err(e) => {
            // 瞬时失败(网络/读体超时)对 UI 与确定性失败同形:success=false + error。
            return Ok(PlanQuotaSnapshot {
                success: false,
                error: Some(e.to_string()),
                utilization: None,
                remaining_tokens: None,
                max_tokens: None,
                resets_at: None,
            });
        }
    };
    tracing::info!(
        check_via = %check_via,
        success = snapshot.success,
        utilization = ?snapshot.utilization,
        "plan quota queried"
    );
    Ok(PlanQuotaSnapshot {
        success: snapshot.success,
        error: snapshot.error,
        utilization: snapshot.utilization,
        remaining_tokens: snapshot.remaining_tokens,
        max_tokens: snapshot.max_tokens,
        resets_at: snapshot.resets_at.map(|dt| dt.to_rfc3339()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// check_via → provider 映射:已实现四家命中,未实现三家报错。
    #[test]
    fn check_via_routes_to_provider_or_error() {
        for ok in ["kimi", "zhipu", "minimax", "zenmux"] {
            assert!(
                make_quota_provider(ok).is_ok(),
                "{ok} should map to a provider"
            );
        }
        for unsupported in ["volcengine", "anthropic_usage", "open_a_i_usage"] {
            let Err(err) = make_quota_provider(unsupported) else {
                panic!("{unsupported} should not map to a provider yet");
            };
            assert!(err.msg.contains("not implemented"), "{err:?}");
        }
        // 注意 serde rename_all = "snake_case" 对连续大写逐字母拆词:
        // OpenAIUsage → "open_a_i_usage"(探测确认)。因此 openai_usage /
        // open_ai_usage 等常见拼法都走 unknown 分支被拒绝,防止静默吞错。
        assert!(make_quota_provider("openai_usage").is_err());
        assert!(make_quota_provider("open_ai_usage").is_err());
        assert!(make_quota_provider("").is_err());
        assert!(make_quota_provider("nonsense").is_err());
    }

    /// 用户真实场景(修复前切换空转的根因):同 provider 两个 plan,
    /// 切到带 model 的凭证条目必须写入 `[active].credential` + 条目 model,
    /// 并由 `resolved_model_spec()` 解析出该条目的 model。
    #[test]
    fn apply_model_switch_pins_credential_and_writes_entry_model() {
        let toml = r#"
            [active]
            provider = "anthropic"

            [anthropic]
            api_key = "sk-top"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-mm"
        "#;
        let mut cfg = reflect_config::load_from_str(toml).unwrap();
        apply_model_switch(&mut cfg, "anthropic", "MiniMax-M3", Some("MiniMax")).unwrap();
        assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
        let entry = cfg.anthropic.as_ref().unwrap().credentials[0]
            .model
            .as_deref();
        assert_eq!(entry, Some("MiniMax-M3"));
        // 钉住条目自带 model → spec 解析取条目 model。
        assert_eq!(
            cfg.resolved_model_spec().as_deref(),
            Some("anthropic/MiniMax-M3")
        );
    }

    /// 切换顶层隐式 plan(credentials 数组无同名条目)→ model 写段级,
    /// `[active].credential` 指向 "default"(builder 把顶层 api_key wrap
    /// 成 label="default" 的池条目,钉住语义依然成立)。
    #[test]
    fn apply_model_switch_default_label_falls_back_to_section_model() {
        let toml = r#"
            [active]
            provider = "anthropic"

            [anthropic]
            api_key = "sk-top"
        "#;
        let mut cfg = reflect_config::load_from_str(toml).unwrap();
        apply_model_switch(&mut cfg, "anthropic", "glm-4.6", Some("default")).unwrap();
        assert_eq!(cfg.active.credential.as_deref(), Some("default"));
        assert_eq!(
            cfg.anthropic.as_ref().unwrap().model.as_deref(),
            Some("glm-4.6")
        );
        assert_eq!(
            cfg.resolved_model_spec().as_deref(),
            Some("anthropic/glm-4.6")
        );
    }

    /// 不传 label(旧调用形态)→ 不钉住,model 写段级。
    #[test]
    fn apply_model_switch_without_label_is_unpinned_section_model() {
        let toml = r#"
            [active]
            provider = "openai"
        "#;
        let mut cfg = reflect_config::load_from_str(toml).unwrap();
        apply_model_switch(&mut cfg, "openai", "gpt-4o", None).unwrap();
        assert_eq!(cfg.active.credential, None);
        assert_eq!(
            cfg.openai.as_ref().unwrap().model.as_deref(),
            Some("gpt-4o")
        );
    }

    /// 显式钉住却找不到条目 → 报错(而非静默写一个指向空处的 pin)。
    #[test]
    fn apply_model_switch_rejects_unknown_label() {
        let toml = r#"
            [active]
            provider = "anthropic"

            [anthropic]
            api_key = "sk-top"
        "#;
        let mut cfg = reflect_config::load_from_str(toml).unwrap();
        let err = apply_model_switch(&mut cfg, "anthropic", "m", Some("ghost")).unwrap_err();
        assert!(err.msg.contains("ghost"), "{err:?}");
    }

    /// 空 model = 清除:钉住条目仍在(切 plan 本身有效),model 缺失由
    /// `resolved_model_spec()` 如实返回 None —— GUI 显示"未配置模型"。
    #[test]
    fn apply_model_switch_empty_model_clears_override() {
        let toml = r#"
            [active]
            provider = "anthropic"
            credential = "MiniMax"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-mm"
            model = "old-model"
        "#;
        let mut cfg = reflect_config::load_from_str(toml).unwrap();
        apply_model_switch(&mut cfg, "anthropic", "  ", Some("MiniMax")).unwrap();
        assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
        assert_eq!(cfg.anthropic.as_ref().unwrap().credentials[0].model, None);
        assert_eq!(cfg.resolved_model_spec(), None);
    }
}
