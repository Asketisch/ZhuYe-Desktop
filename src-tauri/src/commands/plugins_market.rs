//! 插件市场命令面 —— 浏览 marketplace 清单 + 一键安装（含依赖解析）。
//!
//! 自 `commands/plugins.rs` 拆出（500 行预算）：市场浏览/安装与已装
//! 插件管理是两条独立命令族，共享 `PluginManager` 装载入口。

use serde::{Deserialize, Serialize};
use tauri::State;
use zhuye_plugin::{MarketplaceName, PluginScope};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

use super::plugins::load_plugin_manager;

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
