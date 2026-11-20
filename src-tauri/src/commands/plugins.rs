//! 插件命令面 —— slash 菜单数据源 + **插件管理**。
//!
//! 两个职责:
//!
//! 1. `zhuye_list_plugin_commands` —— composer 斜杠菜单的数据源。
//!    只读快照:从挂载好的插件运行时(`state/plugins.rs`)取 slash 命令
//!    注册表。未挂载(占位线程 / 无 enabled 插件 / HOME 缺失)时返回空
//!    列表,前端弹层自然只显示内置命令。
//!
//! 2. **插件管理**(此前 GUI 完全缺失):装了什么、哪个加载失败、启用
//!    哪些、marketplace 有哪些 —— 全部看不到,只能手改
//!    `~/.zhuye/config.toml` 的 `[plugins] enabled_plugins` 与
//!    `installed_plugins.json`。现提供列表 / 启停 / 卸载 / 本地安装。
//!
//! 写路径与核心同款:`PluginManager` 负责 `installed_plugins.json` 的
//! 读写与校验;启停走 config 的 `enabled_plugins` + 核心的
//! `reload_plugins` diff 同步(不打断运行中的会话)。

use serde::{Deserialize, Serialize};
use tauri::State;
use zhuye_plugin::{MarketplaceName, PluginId, PluginManager, PluginScope};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 单个插件 slash 命令的展示信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginCommandInfo {
    /// 命令全名(`plugin:ns:name` 形式,如 `demo:hello`)。前端以
    /// `/name args` 形态插入输入框,后端按同名展开。
    pub name: String,
    /// 命令说明(md frontmatter `description`,可缺省)。
    pub description: Option<String>,
}

/// 一个已安装插件(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    /// 插件 id。
    pub id: String,
    /// 版本号。
    pub version: String,
    /// 安装 scope:`managed` / `user` / `project` / `local`。
    pub scope: String,
    /// 安装路径(绝对路径)。
    pub install_path: String,
    /// 安装时间(RFC3339)。
    pub installed_at: String,
    /// 是否在 `[plugins] enabled_plugins` 里。
    pub enabled: bool,
    /// 当前线程实际加载成功的插件；未加载时为 null。
    pub runtime: Option<zhuye_protocol::PluginLoadedEvent>,
    /// git 安装的 commit sha(本地目录安装时为 null)。
    pub git_commit_sha: Option<String>,
}

/// 一个已知 marketplace(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInfo {
    /// marketplace 名。
    pub name: String,
    /// 源描述(本地路径 / URL / git)。
    pub source: String,
    /// 安装位置(本地缓存目录或 URL)。
    pub install_location: String,
    /// 启动时是否后台刷新。
    pub auto_update: bool,
}

#[tauri::command]
pub async fn zhuye_list_plugin_commands(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<PluginCommandInfo>> {
    let runtime = agent.plugin_runtime();
    let guard = runtime.lock().await;
    let Some(loaded) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(command_infos(loaded.commands().list()))
}

/// 列出已安装插件 + 是否启用。
///
/// 启用状态取自配置；runtime 仅表示当前线程实际加载成功的插件。
#[tauri::command]
pub async fn zhuye_list_plugins(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<PluginInfo>> {
    let _config = agent.inner.config_write_lock.lock().await;
    let _transition = agent.inner.session_transition_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
    let context = agent.inner.plugin_runtime_context.lock().clone();
    let current = agent.inner.thread.lock().clone();
    let loaded = if let Some(context) = context.filter(|context| {
        context
            .owner
            .upgrade()
            .zip(current.as_ref())
            .is_some_and(|(owner, current)| {
                std::sync::Arc::ptr_eq(&owner, current) && !owner.cancel_token().is_cancelled()
            })
    }) {
        context
            .status
            .snapshot()
            .await
            .map_err(CommandError::from)?
    } else {
        Default::default()
    };
    let enabled: std::collections::HashSet<String> = agent
        .inner
        .cfg
        .read()
        .plugins
        .enabled_plugins
        .iter()
        .filter_map(|id| PluginId::parse_user_input(id).ok().map(|id| id.to_string()))
        .collect();
    let manager = load_plugin_manager()?;
    let out = manager
        .list_with_enabled(&enabled)
        .into_iter()
        .map(|(id, entry, is_enabled)| PluginInfo {
            id: id.as_str().to_string(),
            version: entry.version,
            scope: scope_str(entry.scope).to_string(),
            install_path: entry.install_path.display().to_string(),
            installed_at: entry.installed_at.to_rfc3339(),
            enabled: is_enabled,
            runtime: loaded
                .get(id.as_str())
                .filter(|info| info.scope == scope_str(entry.scope))
                .cloned(),
            git_commit_sha: entry.git_commit_sha,
        })
        .collect();
    Ok(out)
}

/// 列出已知 marketplace(config 的 `[plugins].marketplaces`)。
#[tauri::command]
pub async fn zhuye_list_marketplaces(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<MarketplaceInfo>> {
    let cfg = agent.inner.cfg.read().clone();
    let mut out: Vec<MarketplaceInfo> = cfg
        .plugins
        .marketplaces
        .iter()
        .map(|(name, m)| {
            // 安装位置三选一:本地路径 / URL / git repo。
            let location = m
                .path
                .as_ref()
                .map(|p| p.display().to_string())
                .or_else(|| m.url.clone())
                .or_else(|| m.repo.clone())
                .unwrap_or_default();
            MarketplaceInfo {
                name: name.clone(),
                source: marketplace_kind_str(m.kind).to_string(),
                install_location: location,
                auto_update: m.auto_update,
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// marketplace kind → 线格式字符串。
fn marketplace_kind_str(k: zhuye_config::schema::PluginMarketplaceKind) -> &'static str {
    use zhuye_config::schema::PluginMarketplaceKind::*;
    match k {
        Directory => "directory",
        File => "file",
        Github => "github",
        Url => "url",
    }
}

/// 启用 / 停用一个插件。
///
/// 写 config 的 `[plugins] enabled_plugins` → 落盘 → 核心
/// `reload_plugins` diff 同步(挂/卸插件,不打断运行中的会话)。
#[tauri::command]
pub async fn zhuye_toggle_plugin(
    agent: State<'_, MinimalAgent>,
    id: String,
    enabled: bool,
) -> CommandResult<()> {
    let id = PluginId::parse_user_input(&id)
        .map(|id| id.to_string())
        .unwrap_or(id);
    let _config_write = agent.inner.config_write_lock.lock().await;
    let mut cfg = agent.inner.cfg.read().clone();
    let list = &mut cfg.plugins.enabled_plugins;
    let matches_id = |value: &String| match PluginId::parse_user_input(value) {
        Ok(value) => value.as_str() == id,
        Err(_) => value == &id,
    };
    let had = list.iter().any(matches_id);
    if enabled && !had {
        list.push(id.clone());
    } else if !enabled && had {
        list.retain(|value| !matches_id(value));
    } else {
        // 状态没变 —— 幂等返回(不重复落盘)。
        return Ok(());
    }
    // 落盘 + 换内存快照。
    crate::commands::config::persist_config(&agent, cfg.clone())?;
    // diff 同步挂/卸(与模型接入栈热重载的 plugins 分支同语义)。
    let _mount = agent.inner.plugin_mount_lock.lock().await;
    crate::state::plugins::reload_enabled_plugins(&agent, &cfg.plugins.enabled_plugins)
        .await
        .map_err(|e| CommandError {
            msg: format!("plugin configuration saved, but runtime reload failed: {e:#}"),
        })?;
    Ok(())
}

/// 卸载一个插件(按 scope 精确卸载)。
#[tauri::command]
pub async fn zhuye_uninstall_plugin(
    agent: State<'_, MinimalAgent>,
    id: String,
    scope: PluginScope,
) -> CommandResult<()> {
    let plugin_id = PluginId::parse(&id).map_err(|e| CommandError {
        msg: format!("invalid plugin id: {e}"),
    })?;
    let _config_write = agent.inner.config_write_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
    let mut manager = load_plugin_manager()?;
    manager
        .uninstall(&plugin_id, scope)
        .map_err(|e| CommandError {
            msg: format!("uninstall plugin failed: {e}"),
        })?;
    manager.save().map_err(|e| CommandError {
        msg: format!("save plugin state failed: {e}"),
    })?;
    crate::state::plugins::refresh_installed_plugins(&agent)
        .await
        .map_err(|e| CommandError {
            msg: format!("plugin uninstalled, but runtime refresh failed: {e:#}"),
        })?;
    Ok(())
}

/// 从本地目录安装一个插件。
///
/// `path` 指向含 `plugin.toml` 或 `.claude-plugin/plugin.json` 的目录
/// (GUI 的文件选择框可提供)。安装后写 `installed_plugins.json`。
#[tauri::command]
pub async fn zhuye_install_plugin(
    agent: State<'_, MinimalAgent>,
    path: String,
    marketplace: String,
    scope: PluginScope,
) -> CommandResult<()> {
    let mkt = MarketplaceName::parse(&marketplace).map_err(|e| CommandError {
        msg: format!("invalid marketplace name: {e}"),
    })?;
    let _config_write = agent.inner.config_write_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
    let mut manager = load_plugin_manager()?;
    manager
        .install_local(&path, &mkt, scope)
        .map_err(|e| CommandError {
            msg: format!("install plugin failed: {e}"),
        })?;
    manager.save().map_err(|e| CommandError {
        msg: format!("save plugin state failed: {e}"),
    })?;
    crate::state::plugins::refresh_installed_plugins(&agent)
        .await
        .map_err(|e| CommandError {
            msg: format!("plugin installed, but runtime refresh failed: {e:#}"),
        })?;
    Ok(())
}

// ── v1.11 桌面#2:插件市场浏览 + 一键安装 ─────────────────────────────

/// 市场内一个可安装插件的展示信息(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePluginInfo {
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    /// 分发源描述(与 MarketplaceSource 序列化形态一致)。
    pub source: String,
}

/// 读 `known_marketplaces.json`(文件缺失 → 空表 —— 用户还没加过市场
/// 是正常状态,不是错误)。
fn load_known_marketplaces() -> CommandResult<zhuye_plugin::KnownMarketplacesFile> {
    let Some(path) = zhuye_plugin::default_marketplaces_path() else {
        return Err(CommandError {
            msg: "no HOME dir for marketplaces.json".into(),
        });
    };
    if !path.exists() {
        return Ok(zhuye_plugin::KnownMarketplacesFile::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| CommandError {
        msg: format!("read marketplaces.json failed: {e}"),
    })?;
    serde_json::from_str(&text).map_err(|e| CommandError {
        msg: format!("parse marketplaces.json failed: {e}"),
    })
}

/// v1.11 桌面#2:浏览一个 marketplace 的可安装插件清单。
///
/// 读 known_marketplaces.json 里该市场的缓存目录,解析
/// `.claude-plugin/marketplace.json` manifest,逐条返回插件元信息。
/// 市场未注册 / 缓存未物化 → 显性报错(提示先 `marketplace add` /
/// CLI refresh)。
#[tauri::command]
pub async fn zhuye_browse_marketplace(name: String) -> CommandResult<Vec<MarketplacePluginInfo>> {
    let mkt = MarketplaceName::parse(&name).map_err(|e| CommandError {
        msg: format!("invalid marketplace name: {e}"),
    })?;
    let known = load_known_marketplaces()?;
    let entry = known.marketplaces.get(&mkt).ok_or_else(|| CommandError {
        msg: format!(
            "marketplace '{name}' not registered; add it via `zhuye plugin marketplace add` first"
        ),
    })?;
    let manifest_path = zhuye_plugin::MarketplaceManifest::find_in_dir(&entry.install_location)
        .ok_or_else(|| CommandError {
            msg: format!(
                "marketplace manifest not found under {} (run `zhuye plugin marketplace refresh --name {name}`)",
                entry.install_location.display()
            ),
        })?;
    let manifest =
        zhuye_plugin::MarketplaceManifest::from_json_path(&manifest_path).map_err(|e| {
            CommandError {
                msg: format!("parse marketplace manifest failed: {e}"),
            }
        })?;
    Ok(manifest
        .plugins
        .into_iter()
        .map(|p| MarketplacePluginInfo {
            name: p.manifest.name,
            description: p.manifest.description.unwrap_or_default(),
            version: p.manifest.version,
            category: p.category,
            tags: p.tags,
            source: serde_json::to_string(&p.source).unwrap_or_default(),
        })
        .collect())
}

/// v1.11 桌面#2:从 marketplace 一键安装插件(含依赖 DFS 解析)。
///
/// 复用 CLI 同款链路:known_marketplaces.json 取 cache root →
/// `PluginManager::install_from_marketplace`(DepResolver 后序装依赖)
/// → save → 运行时 refresh(挂载能力)。
#[tauri::command]
pub async fn zhuye_install_from_marketplace(
    agent: State<'_, MinimalAgent>,
    marketplace: String,
    plugin: String,
) -> CommandResult<()> {
    let mkt = MarketplaceName::parse(&marketplace).map_err(|e| CommandError {
        msg: format!("invalid marketplace name: {e}"),
    })?;
    let known = load_known_marketplaces()?;
    let entry = known.marketplaces.get(&mkt).ok_or_else(|| CommandError {
        msg: format!(
            "marketplace '{marketplace}' not registered; add it via `zhuye plugin marketplace add` first"
        ),
    })?;
    let cache_root = entry.install_location.clone();
    let _config_write = agent.inner.config_write_lock.lock().await;
    let _mount = agent.inner.plugin_mount_lock.lock().await;
    let mut manager = load_plugin_manager()?;
    let report = manager
        .install_from_marketplace(&known, &cache_root, &mkt, &plugin, PluginScope::User)
        .map_err(|e| CommandError {
            msg: format!("install from marketplace failed: {e}"),
        })?;
    if !report.is_success() {
        // 依赖解析失败逐条显性化(与 CLI render_install_report 同语义)。
        let failed: Vec<String> = report
            .failed
            .iter()
            .map(|f| format!("{}: {}", f.target, f.error))
            .collect();
        return Err(CommandError {
            msg: format!("install failed: {}", failed.join("; ")),
        });
    }
    manager.save().map_err(|e| CommandError {
        msg: format!("save plugin state failed: {e}"),
    })?;
    crate::state::plugins::refresh_installed_plugins(&agent)
        .await
        .map_err(|e| CommandError {
            msg: format!("plugin installed, but runtime refresh failed: {e:#}"),
        })?;
    Ok(())
}

/// 加载插件管理器(读 `installed_plugins.json`)。
///
/// 读不到(HOME 缺失 / 文件不存在)→ 空管理器(不是错误 —— 用户还没装过
/// 任何插件是正常状态)。
fn load_plugin_manager() -> CommandResult<PluginManager> {
    let Some(root) = zhuye_plugin::default_plugins_root() else {
        return Err(CommandError {
            msg: "no HOME dir for plugins root".into(),
        });
    };
    PluginManager::load(root).map_err(|e| CommandError {
        msg: format!("load plugin state failed: {e}"),
    })
}

/// `PluginScope` → 线格式字符串(与 serde 的 `rename_all = "lowercase"` 一致)。
fn scope_str(s: PluginScope) -> &'static str {
    match s {
        PluginScope::Managed => "managed",
        PluginScope::User => "user",
        PluginScope::Project => "project",
        PluginScope::Local => "local",
    }
}

/// LoadedCommand → 展示信息(纯映射,单测覆盖)。
fn command_infos(commands: Vec<zhuye_plugin::LoadedCommand>) -> Vec<PluginCommandInfo> {
    commands
        .into_iter()
        .map(|c| PluginCommandInfo {
            name: c.name,
            description: c.description,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 映射保持 name/description,字段一一对应。
    #[test]
    fn maps_loaded_commands_to_infos() {
        let infos = command_infos(vec![zhuye_plugin::LoadedCommand {
            name: "demo:hello".into(),
            file_path: PathBuf::from("/tmp/hello.md"),
            description: Some("say hi".into()),
        }]);
        assert_eq!(
            infos,
            vec![PluginCommandInfo {
                name: "demo:hello".into(),
                description: Some("say hi".into()),
            }]
        );
    }

    #[test]
    fn maps_empty_registry_to_empty_vec() {
        assert!(command_infos(vec![]).is_empty());
    }
}
