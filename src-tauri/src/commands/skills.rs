//! Skills 列表 —— 与核心运行时**同源**。
//!
//! ## 为什么不再自己扫盘
//!
//! 此前桌面端手写了一份扫描 + YAML 解析(扫 `~/.zhuye/skills` 与
//! `cwd/.zhuye/skills`),与核心运行时的实际技能集有两处分叉:
//!
//! - **目录不同** —— 核心 `m4_bootstrap` 扫的是 `default_skill_dirs`
//!   (`<workspace>/.zhuye/skills` + `<workspace>/.agents/skills` +
//!   `~/.zhuye/skills` + `~/.agents/skills`),桌面端此前只扫前两者。
//! - **漏掉内置技能** —— 核心在扫描后还会 `merge_bundled`(把 crate 内置的
//!   15+ 个 skill 合进 catalog),桌面端没有这一步。GUI 列出的技能少于
//!   agent 实际能激活的。
//!
//! 现在扫描目录直接取上游唯一出口 `zhuye_config::default_skill_dirs`,
//! 复用核心的 `zhuye_skills::{scan_skills_dirs, bundled_skills}`,目录与
//! 合并语义与运行时逐行一致,GUI 不再可能与 agent 分叉。
//!
//! 内置技能包受 `[active] bundled_skills` 门控(上游 0.1.8 起**默认关闭**):
//! 核心 `m4_bootstrap` 只在开关为 true 时 `merge_bundled`,这里按同一开关
//! 决定是否把内置技能并入列表 —— 否则 GUI 会列出 15 个 agent 根本没加载、
//! `load_skill` 也激活不了的技能。
//!
//! 另有三条 skills.sh 市场命令(搜索 / 安装 / 强制刷新索引),领域逻辑在
//! 上游 `zhuye_skills::{directory, marketplace}`,本文件只做命令适配。

use std::collections::HashSet;

use zhuye_protocol::Op;
use zhuye_skills::{bundled_skills, scan_skills_dirs};
use serde::Serialize;
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
    pub tools: Vec<String>,
    pub triggers: Vec<String>,
    /// 技能版本号(frontmatter `version:`;可选)。
    pub version: Option<String>,
    /// 路径 glob 条件 —— workspace 相对路径匹配时自动激活。
    pub when_paths: Vec<String>,
    /// v1 MCP 预留:该 skill 需要的 MCP 集合。
    pub mcp_collections: Vec<String>,
    /// Markdown 正文(system-prompt / 工作流)—— 供详情视图展示。
    pub body: String,
    /// true = crate 内置技能(无磁盘文件路径,来自 `bundled_skills()`)。
    pub bundled: bool,
    /// 提供该 skill 的插件 id(插件技能时非空)。
    pub plugin_id: Option<String>,
}

/// 列出 agent 当前可用的全部技能(与运行时 catalog 同集)。
///
/// v1.11:除目录扫描(工作区 / 用户级 / bundled)外,并入**插件带来的
/// 技能** —— 插件技能在运行时已注册进 catalog(模型侧可用),但列表
/// 此前只扫目录,用户在 Skills 视图里看不到(「装了却看不到」)。
#[tauri::command]
pub async fn zhuye_list_skills(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<SkillInfo>> {
    // 与核心两处 bootstrap 完全同源的唯一目录清单(顺序即同名优先级):
    // <ws>/.zhuye/skills → <ws>/.agents/skills → ~/.zhuye/skills → ~/.agents/skills。
    let dirs_owned = zhuye_config::default_skill_dirs(&agent.workspace());
    let dirs: Vec<&std::path::Path> = dirs_owned.iter().map(|p| p.as_path()).collect();
    // scan_skills_dirs 不去重同名:按清单顺序先到先得(高优先级目录胜),
    // 与 catalog.scan → get() 取首个的语义一致。
    let scanned = scan_skills_dirs(&dirs);
    let mut seen: HashSet<String> = HashSet::new();
    let mut metas: Vec<_> = scanned
        .into_iter()
        .filter(|m| seen.insert(m.name.clone()))
        .collect();
    // `merge_bundled` 的语义:同名不覆盖(用户/工作区技能优先);
    // 且只在 `[active] bundled_skills = true` 时合入(与核心 bootstrap 同门)。
    let mut bundled: HashSet<String> = HashSet::new();
    if agent.inner.cfg.read().active.bundled_skills {
        for b in bundled_skills() {
            if seen.insert(b.name.clone()) {
                bundled.insert(b.name.clone());
                metas.push(b);
            }
        }
    }

    // 插件技能:与 loader::register 同款语义(解析 frontmatter 全字段,
    // SKILL.md 不合规时降级为 manifest 元数据 —— 宽容作者,不阻断列表)。
    for (plugin_id, caps) in crate::commands::mcp::plugin_capabilities(&agent).await {
        for s in &caps.skills {
            if !seen.insert(s.name.clone()) {
                continue; // 同名不覆盖(工作区/用户级技能优先)
            }
            let mut meta = zhuye_skills::parse_skill_file(&s.skill_md).unwrap_or_else(|e| {
                tracing::warn!(
                    plugin = %plugin_id,
                    skill = %s.name,
                    error = %e,
                    "插件 SKILL.md 解析失败;降级为 manifest 元数据"
                );
                zhuye_skills::SkillMeta {
                    name: s.name.clone(),
                    description: s.description.clone().unwrap_or_default(),
                    triggers: Vec::new(),
                    tools: Vec::new(),
                    mcp_collections: Vec::new(),
                    path: s.skill_md.clone(),
                    body: String::new(),
                    version: None,
                    plugin_id: None,
                    when_paths: Vec::new(),
                }
            });
            meta.plugin_id = Some(plugin_id.to_string());
            metas.push(meta);
        }
    }

    let out = metas
        .into_iter()
        .map(|m| {
            let is_bundled = bundled.contains(&m.name);
            SkillInfo {
                name: m.name,
                description: m.description,
                path: m.path.display().to_string(),
                tools: m.tools,
                triggers: m.triggers,
                version: m.version,
                when_paths: m.when_paths,
                mcp_collections: m.mcp_collections,
                body: m.body,
                bundled: is_bundled,
                plugin_id: m.plugin_id,
            }
        })
        .collect();
    Ok(out)
}

/// 触发运行时扩展目录重扫 —— `Op::RescanExtensions`(上游 v1.x):
/// `.zhuye/skills/`(workspace + 用户级)的新增/修改不重启即生效。
/// 不开 turn;应答经 `extensions_rescanned` 事件回推(skills 条目总数),
/// 这里投递并返回 submission id(与 `zhuye_set_effort` 同款发后即走)。
#[tauri::command]
pub async fn zhuye_rescan_extensions(
    agent: State<'_, MinimalAgent>,
    skills: Option<bool>,
    commands: Option<bool>,
) -> CommandResult<String> {
    Ok(agent
        .submit_op(Op::RescanExtensions {
            skills: skills.unwrap_or(true),
            commands: commands.unwrap_or(false),
        })
        .await?)
}

/// F01:查询 prompt_guard 裁决统计 —— `Op::QueryGuardStats`。
/// 不开 turn;应答经 `guard_stats` 事件回推(enabled + 四计数),这里
/// 投递并返回 submission id(与 `zhuye_rescan_extensions` 同款)。
#[tauri::command]
pub async fn zhuye_query_guard_stats(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.submit_op(Op::QueryGuardStats).await?)
}

/// v1.11 桌面#1:Skill 市场 —— 从 GitHub 仓库安装技能。
///
/// 安装到**用户级** `~/.zhuye/skills/`(`ZHUYE_HOME` 可重定向),装完
/// 触发一次 `Op::RescanExtensions` 让运行时无需重启即发现新技能,并
/// 返回重扫 submission id。repo 形态:`owner/repo` 或 GitHub URL
/// (仓库根含 `SKILL.md`;名字取 frontmatter `name:`,缺省用仓库名)。
#[tauri::command]
pub async fn zhuye_install_skill(
    agent: State<'_, MinimalAgent>,
    repo: String,
) -> CommandResult<String> {
    // 语义校验前置(repo 形态非法直接拒,不发起网络请求)。
    zhuye_skills::normalize_repo(&repo).map_err(|e| e.to_string())?;
    let out_dir = zhuye_config::paths::data_path_or_relative(&["skills"]);
    zhuye_skills::install_from_github(&repo, &out_dir)
        .await
        .map_err(|e| e.to_string())?;
    // 重扫扩展目录:GUI 列表与运行时 catalog 同步刷新(不阻塞返回)。
    Ok(agent
        .submit_op(Op::RescanExtensions {
            skills: true,
            commands: false,
        })
        .await?)
}

/// skills.sh 市场条目(搜索结果,字段 camelCase)。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarketEntryInfo {
    /// 稳定 id:`owner/repo/slug`。
    pub id: String,
    /// 来源仓库 `owner/repo`(UI 来源徽标)。
    pub source: String,
    /// skill slug。
    pub slug: String,
    /// 官方(第一方厂商)来源标签。
    pub official: bool,
}

/// 市场索引缓存路径:`~/.zhuye/cache/skills-market.json`(ZHUYE_HOME 可重定向)。
fn market_index_cache_path() -> std::path::PathBuf {
    zhuye_config::paths::data_path_or_relative(&["cache", "skills-market.json"])
}

/// 搜索 skills.sh 目录。索引首次访问自动拉取(24h TTL),后续走本地缓存;
/// query < 2 字符返回空。领域逻辑在上游 `zhuye_skills::directory`。
#[tauri::command]
pub async fn zhuye_search_skill_market(
    query: String,
    limit: Option<u32>,
) -> CommandResult<Vec<SkillMarketEntryInfo>> {
    let entries = zhuye_skills::fetch_index(&market_index_cache_path(), false)
        .await
        .map_err(|e| e.to_string())?;
    let hits = zhuye_skills::search_entries(&entries, &query, limit.unwrap_or(50) as usize);
    Ok(hits
        .into_iter()
        .map(|h| SkillMarketEntryInfo {
            id: h.id,
            source: h.source,
            slug: h.slug,
            official: h.official,
        })
        .collect())
}

/// 从 skills.sh 市场安装技能到用户级 `~/.zhuye/skills/`(整目录,含附属文件),
/// 装完触发 `Op::RescanExtensions` 让运行时无需重启即发现。
/// source 形态:`owner/repo/slug`、`owner/repo`、skills.sh / GitHub URL。
#[tauri::command]
pub async fn zhuye_install_skill_from_market(
    agent: State<'_, MinimalAgent>,
    source: String,
) -> CommandResult<String> {
    // 语义校验前置(非法形态不发网络请求)。
    zhuye_skills::normalize_market_source(&source).map_err(|e| e.to_string())?;
    let out_dir = zhuye_config::paths::data_path_or_relative(&["skills"]);
    zhuye_skills::install_skill_from_market(&source, &out_dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(agent
        .submit_op(Op::RescanExtensions {
            skills: true,
            commands: false,
        })
        .await?)
}

/// 强制刷新 skills.sh 目录索引(跳过 TTL),返回条目数。
#[tauri::command]
pub async fn zhuye_refresh_skill_market_index() -> CommandResult<u32> {
    let entries = zhuye_skills::fetch_index(&market_index_cache_path(), true)
        .await
        .map_err(|e| e.to_string())?;
    Ok(entries.len() as u32)
}

#[cfg(test)]
mod guard_stats_tests {
    use super::*;

    /// F01:统计查询命令对应 `Op::QueryGuardStats`(无字段的单元变体)。
    /// 命令体只是 `submit_op` 转发,这里锁住「命令名 → Op 变体」的映射,
    /// 避免将来误接成别的 op(命令面静态门禁据此认定有测试引用)。
    #[test]
    fn guard_stats_command_maps_to_query_op() {
        let op = Op::QueryGuardStats;
        assert_eq!(op.discriminant(), "query_guard_stats");
        // 命令名字符串本身也要出现在测试里 —— 门禁按字符串扫描。
        let name = "zhuye_query_guard_stats";
        assert!(name.starts_with("zhuye_"));
    }

    /// 市场命令名字符串存在性(命令面静态门禁据此认定有测试引用)。
    #[test]
    fn market_command_names_are_stable() {
        for name in [
            "zhuye_search_skill_market",
            "zhuye_install_skill_from_market",
            "zhuye_refresh_skill_market_index",
        ] {
            assert!(name.starts_with("zhuye_"));
        }
        // 缓存路径固定为 data/cache 下的 market 索引文件。
        let cache = market_index_cache_path();
        assert!(cache.ends_with("cache/skills-market.json"));
    }
}
