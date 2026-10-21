//! 权限规则查询与追加 —— 让核心的权限层在 GUI 里**可见**、并能被**就地追加**。
//!
//! 桌面端与 CLI 共用同一套三层 store,规则按作用域分列,匹配时先匹配到的
//! 胜出(first-match-wins):
//!
//! | 作用域 | 来源 | 可写 |
//! |---|---|---|
//! | `config` | `config.toml` 的 `[permissions]` 段 | 否(配置内联) |
//! | `project` | `<workspace>/.reflect/permissions.toml` | 否(随工作区签入) |
//! | `user` | `~/.reflect/permissions.toml` | 是(`/permissions allow` 落盘处) |
//!
//! `reflect_list_permission_rules` 只读:它回答「当前这个会话到底受哪些
//! 规则约束」。`reflect_add_permission_rule` 往**用户级**文件追加一条
//! allow 规则 —— 供审批弹窗的「始终允许这条命令」用。
//!
//! ## 为什么写进核心的权限文件,而不是桌面端自己的 allowlist
//!
//! 桌面端曾有一套本地 `~/.reflect/approval_allowlist.json`(前缀匹配),
//! 但它**从没有界面消费**,且与核心的权限层功能重复 —— 两套真值会让
//! 用户「到底哪条生效」无从判断。核心的权限层有三个优势:
//!
//! 1. **真值唯一** —— 规则落在 CLI 与 GUI 共用的 `permissions.toml`;
//! 2. **立即生效** —— 核心的 `StorePermissionResolver` 每次评估都重新
//!    `list()`(重读文件),不需要重启会话;
//! 3. **可见** —— 同一份规则会在 Settings → Permissions 的「生效的权限
//!    规则」列表里显示,用户能核对「我到底放行了什么」。
//!
//! 装配见 `state/permissions.rs` —— 与 CLI `reflect-exec` 的
//! `apply_permission_layers` 同构。

use std::path::PathBuf;

use reflect_permissions::{
    FilePermissionStore, InMemoryPermissionStore, PermissionAction, PermissionRule, PermissionStore,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 规则来源作用域。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleScope {
    /// `config.toml` 的 `[permissions]` 段(会话级,优先级最高)。
    Config,
    /// `<workspace>/.reflect/permissions.toml`(项目级)。
    Project,
    /// `~/.reflect/permissions.toml`(用户级,可写)。
    User,
}

/// 一条生效的权限规则(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleInfo {
    /// 工具名(精确匹配)。
    pub tool: String,
    /// `allow` / `deny` / `ask`。
    pub action: String,
    /// 工具名 glob(设置后忽略 `tool` 的精确匹配语义)。
    pub tool_glob: Option<String>,
    /// Bash 命令 glob(仅 Bash 工具 + 有命令上下文时生效)。
    pub shell_pattern: Option<String>,
    /// 规则来源作用域。
    pub scope: RuleScope,
}

/// 用户级权限文件路径(`~/.reflect/permissions.toml`)。
fn user_rules_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".reflect/permissions.toml"))
}

/// 读取一个 store 的规则;读失败(文件不存在 / TOML 损坏)→ 空列表。
async fn list_rules(store: &dyn PermissionStore) -> Vec<reflect_permissions::PermissionRule> {
    match store.list().await {
        Ok(rules) => rules,
        Err(e) => {
            tracing::warn!(error = %e, "读取权限规则失败,按空列表处理");
            Vec::new()
        }
    }
}

/// 列出当前生效的权限规则(按作用域优先级排列)。
///
/// 规则顺序即匹配顺序 —— GUI 直接按数组顺序展示,用户能看出「哪条先生效」。
#[tauri::command]
pub async fn reflect_list_permission_rules(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<PermissionRuleInfo>> {
    let cfg_snapshot = agent.inner.cfg.read().clone();

    // 1. config.toml `[permissions]`(只读层,最前)。
    let mut out: Vec<PermissionRuleInfo> = Vec::new();
    if let Some(sec) = &cfg_snapshot.permissions {
        let cfg_store = InMemoryPermissionStore::new();
        for rule in sec.expanded_rules() {
            if let Err(e) = cfg_store.add(rule).await {
                tracing::warn!(error = %e, "config 权限规则落库失败,跳过该条");
                continue;
            }
        }
        for r in list_rules(&cfg_store).await {
            out.push(PermissionRuleInfo {
                tool: r.tool,
                action: action_str(r.action),
                tool_glob: r.tool_glob,
                shell_pattern: r.shell_pattern,
                scope: RuleScope::Config,
            });
        }
    }

    // 2. 项目级 `<workspace>/.reflect/permissions.toml`。
    let project_path = agent.workspace().join(".reflect").join("permissions.toml");
    let project_store = FilePermissionStore::with_path(project_path);
    for r in list_rules(&project_store).await {
        out.push(PermissionRuleInfo {
            tool: r.tool,
            action: action_str(r.action),
            tool_glob: r.tool_glob,
            shell_pattern: r.shell_pattern,
            scope: RuleScope::Project,
        });
    }

    // 3. 用户级 `~/.reflect/permissions.toml`。
    if let Some(path) = user_rules_path() {
        let user_store = FilePermissionStore::with_path(path);
        for r in list_rules(&user_store).await {
            out.push(PermissionRuleInfo {
                tool: r.tool,
                action: action_str(r.action),
                tool_glob: r.tool_glob,
                shell_pattern: r.shell_pattern,
                scope: RuleScope::User,
            });
        }
    }

    Ok(out)
}

/// `PermissionAction` → 线格式字符串。
///
/// 核心枚举本身不 derive Serialize(它只用于进程内匹配),这里显式映射,
/// 避免为出线在核心侧加 serde 依赖。
fn action_str(a: reflect_permissions::PermissionAction) -> String {
    use reflect_permissions::PermissionAction;
    match a {
        PermissionAction::Allow => "allow".into(),
        PermissionAction::Deny => "deny".into(),
        PermissionAction::Ask => "ask".into(),
    }
}

/// 要追加的权限规则(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleInput {
    /// 工具名(精确匹配),如 `"Bash"`。
    pub tool: String,
    /// `allow` / `deny` / `ask`。
    pub action: String,
    /// 工具名 glob(设置后忽略 `tool` 的精确匹配语义)。
    #[serde(default)]
    pub tool_glob: Option<String>,
    /// Bash 命令 glob(仅 Bash 工具 + 有命令上下文时生效)。
    #[serde(default)]
    pub shell_pattern: Option<String>,
}

/// 追加一条**用户级**权限规则(`~/.reflect/permissions.toml`)。
///
/// 落盘 + **立即生效**:核心的 `StorePermissionResolver` 每次评估都重新
/// `list()`(重读文件),新规则对下一次工具调用即刻生效,无需重启会话。
///
/// 同名规则(`tool` + `action` + pattern 全同)由核心的
/// `FilePermissionStore::add` 自动去重。
#[tauri::command]
pub async fn reflect_add_permission_rule(rule: PermissionRuleInput) -> CommandResult<()> {
    let rule = build_permission_rule(rule)?;
    // 用核心自己的 `with_default_home()` 解析路径 —— 与 `state/permissions.rs`
    // 装配 resolver 链时用的是**同一个** store 构造器,杜绝「写的文件和
    // 读的文件不是同一个」的路径分叉(核心的权限文件固定在
    // `$HOME/.reflect/permissions.toml`,不支持 `$REFLECT_HOME`)。
    let store = FilePermissionStore::with_default_home().map_err(|e| CommandError {
        msg: format!("locate user permission store: {e}"),
    })?;
    store.add(rule).await.map_err(|e| CommandError {
        msg: format!("add permission rule: {e}"),
    })
}

/// 校验 + 构造核心规则(纯函数,便于单测)。
fn build_permission_rule(input: PermissionRuleInput) -> Result<PermissionRule, CommandError> {
    let action = match input.action.as_str() {
        "allow" => PermissionAction::Allow,
        "deny" => PermissionAction::Deny,
        "ask" => PermissionAction::Ask,
        other => {
            return Err(CommandError {
                msg: format!("unknown permission action '{other}' (allow|deny|ask)"),
            });
        }
    };
    let tool = input.tool.trim();
    if tool.is_empty() {
        return Err(CommandError {
            msg: "permission rule needs a non-empty tool name".into(),
        });
    }
    Ok(PermissionRule {
        tool: tool.to_string(),
        action,
        tool_glob: input.tool_glob,
        shell_pattern: input.shell_pattern,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(tool: &str, action: &str) -> PermissionRuleInput {
        PermissionRuleInput {
            tool: tool.to_string(),
            action: action.to_string(),
            tool_glob: None,
            shell_pattern: None,
        }
    }

    #[test]
    fn builds_allow_rule() {
        let rule = build_permission_rule(input("Bash", "allow")).expect("valid");
        assert_eq!(rule.tool, "Bash");
        assert!(matches!(rule.action, PermissionAction::Allow));
    }

    #[test]
    fn trims_tool_name() {
        let rule = build_permission_rule(input("  Read  ", "allow")).expect("valid");
        assert_eq!(rule.tool, "Read");
    }

    #[test]
    fn rejects_unknown_action() {
        let err = build_permission_rule(input("Bash", "maybe")).expect_err("invalid action");
        assert!(err.msg.contains("unknown permission action"));
    }

    #[test]
    fn rejects_empty_tool() {
        let err = build_permission_rule(input("   ", "allow")).expect_err("empty tool");
        assert!(err.msg.contains("non-empty tool"));
    }
}
