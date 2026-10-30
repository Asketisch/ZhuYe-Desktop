//! 权限规则查询与追加 —— 让核心的权限层在 GUI 里**可见**、并能被**就地追加**。
//!
//! 桌面端与 CLI 共用同一套三层 store,规则按作用域分列,匹配时先匹配到的
//! 依序读取；匹配的 deny 优先于其他规则:
//!
//! | 作用域 | 来源 | 可写 |
//! |---|---|---|
//! | `config` | `config.toml` 的 `[permissions]` 段 | 否(配置内联) |
//! | `project` | `<workspace>/.zhuye/permissions.toml` | 否(随工作区签入) |
//! | `user` | `~/.zhuye/permissions.toml` | 是(`/permissions allow` 落盘处) |
//!
//! `reflect_list_permission_rules` 只读:它回答「当前这个会话到底受哪些
//! 规则约束」。`reflect_add_permission_rule` 往**用户级**文件追加一条
//! allow 规则 —— 供审批弹窗的「始终允许这条命令」用。
//!
//! ## 为什么写进核心的权限文件,而不是桌面端自己的 allowlist
//!
//! 桌面端曾有一套本地 `~/.zhuye/approval_allowlist.json`(前缀匹配),
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
    /// `<workspace>/.zhuye/permissions.toml`(项目级)。
    Project,
    /// `~/.zhuye/permissions.toml`(用户级,可写)。
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

/// 缺失文件由核心视为空规则；解析或读取失败必须向界面报告。
async fn list_rules(
    store: &dyn PermissionStore,
    scope: &str,
) -> CommandResult<Vec<PermissionRule>> {
    store.list().await.map_err(|error| CommandError {
        msg: format!("read {scope} permission rules: {error}"),
    })
}

/// 列出当前生效的权限规则(按作用域优先级排列)。
///
/// GUI 按规则顺序展示；任何匹配的 deny 均优先于 allow / ask。
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
            cfg_store.add(rule).await.map_err(|error| CommandError {
                msg: format!("load config permission rules: {error}"),
            })?;
        }
        for r in list_rules(&cfg_store, "config").await? {
            out.push(PermissionRuleInfo {
                tool: r.tool,
                action: action_str(r.action),
                tool_glob: r.tool_glob,
                shell_pattern: r.shell_pattern,
                scope: RuleScope::Config,
            });
        }
    }

    // 2. 项目级 `<workspace>/.zhuye/permissions.toml`。
    let project_path =
        reflect_app_core::paths::project_data_path(&agent.workspace(), &["permissions.toml"]);
    let project_store = FilePermissionStore::with_path(project_path);
    for r in list_rules(&project_store, "project").await? {
        out.push(PermissionRuleInfo {
            tool: r.tool,
            action: action_str(r.action),
            tool_glob: r.tool_glob,
            shell_pattern: r.shell_pattern,
            scope: RuleScope::Project,
        });
    }

    // 3. 用户级 `~/.zhuye/permissions.toml`。
    {
        let user_store =
            FilePermissionStore::with_default_home().map_err(|error| CommandError {
                msg: format!("locate user permission store: {error}"),
            })?;
        for r in list_rules(&user_store, "user").await? {
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

/// 只读的用户级权限文件必须报权限错误,不能被临时文件替换静默覆盖。
///
/// 核心的 `FilePermissionStore::add` 走「同目录临时文件 + 原子替换」,
/// rename 只查目录权限 —— 已有文件的只读位拦不住它。这里在落盘前显式
/// 确认目标本身可写,与桌面状态文件的 `persistence::write_atomic`
/// 同一口径;文件不存在时不拦截,交给 store 自己创建。
fn guard_readonly_target(path: &std::path::Path) -> CommandResult<()> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CommandError {
                msg: format!("stat user permission file: {error}"),
            });
        }
    };
    if metadata.permissions().readonly() {
        return Err(CommandError {
            msg: "user permission file is read-only".into(),
        });
    }
    Ok(())
}

/// 追加一条**用户级**权限规则(`~/.zhuye/permissions.toml`)。
///
/// 落盘 + **立即生效**:核心的 `StorePermissionResolver` 每次评估都重新
/// `list()`(重读文件),新规则对下一次工具调用即刻生效,无需重启会话。
///
/// 同名规则(`tool` + `action` + pattern 全同)由核心的
/// `FilePermissionStore::add` 自动去重。只读的目标文件报权限错误,
/// 原样保留。
#[tauri::command]
pub async fn reflect_add_permission_rule(rule: PermissionRuleInput) -> CommandResult<()> {
    let rule = build_permission_rule(rule)?;
    // 用核心自己的 `with_default_home()` 解析路径 —— 与 `state/permissions.rs`
    // 装配 resolver 链时用的是**同一个** store 构造器,杜绝「写的文件和
    // 读的文件不是同一个」的路径分叉(核心的权限文件固定在
    // `$HOME/.zhuye/permissions.toml`,`ZHUYE_HOME` 由 store 自己解析)。
    let store = FilePermissionStore::with_default_home().map_err(|e| CommandError {
        msg: format!("locate user permission store: {e}"),
    })?;
    guard_readonly_target(store.path())?;
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

    #[cfg(unix)]
    #[test]
    fn guard_rejects_read_only_file_but_passes_absent_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permissions.toml");
        std::fs::write(&path, "[[rule]]\ntool = \"x\"\naction = \"deny\"\n").unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        let err = guard_readonly_target(&path).expect_err("read-only target");
        assert!(err.msg.contains("read-only"));
        // 不存在的文件不拦截 —— 交给 store 自己创建。
        assert!(guard_readonly_target(&dir.path().join("absent.toml")).is_ok());
    }

    #[test]
    fn escaped_literal_shell_pattern_matches_only_the_original_command() {
        use reflect_permissions::{RuleMatch, evaluate_with_context};
        let mut request = input("Bash", "allow");
        request.shell_pattern = Some("echo [*] [?] [[]x[]] [{]a,b[}]".into());
        let rules = [build_permission_rule(request).unwrap()];
        assert_eq!(
            evaluate_with_context(&rules, "Bash", Some("echo * ? [x] {a,b}")),
            RuleMatch::Allow
        );
        assert_eq!(
            evaluate_with_context(&rules, "Bash", Some("echo anything x [x] {a,b}")),
            RuleMatch::NoMatch
        );
    }
}
