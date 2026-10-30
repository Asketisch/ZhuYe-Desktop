//! Skills 列表 —— 与核心运行时**同源**。
//!
//! ## 为什么不再自己扫盘
//!
//! 此前桌面端手写了一份扫描 + YAML 解析(扫 `~/.zhuye/skills` 与
//! `cwd/.zhuye/skills`),与核心运行时的实际技能集有两处分叉:
//!
//! - **目录不同** —— 核心 `m4_bootstrap` 扫的是
//!   `<workspace>/.zhuye/skills` 加 `~/.zhuye/skills`;桌面端扫的是
//!   `cwd`。进程工作目录与 agent 工作区不是一回事,列表因此可能为空或
//!   指向错误的目录。
//! - **漏掉内置技能** —— 核心在扫描后还会 `merge_bundled`(把 crate 内置的
//!   15+ 个 skill 合进 catalog),桌面端没有这一步。GUI 列出的技能少于
//!   agent 实际能激活的。
//!
//! 现在直接复用核心的 `reflect_skills::{scan_skills_dirs, bundled_skills}`,
//! 目录与合并语义与运行时逐行一致,GUI 不再可能与 agent 分叉。

use std::collections::HashSet;
use std::path::PathBuf;

use reflect_skills::{bundled_skills, scan_skills_dirs};
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
#[tauri::command]
pub async fn reflect_list_skills(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<SkillInfo>> {
    let ws_skills: PathBuf =
        reflect_app_core::paths::project_data_path(&agent.workspace(), &["skills"]);
    let home_skills: PathBuf = reflect_app_core::paths::user_data_path_or_relative(&["skills"]);
    let dirs = [ws_skills.as_path(), home_skills.as_path()];

    // 与核心 `m4_bootstrap` 同序:工作区在前、用户级在后。
    let mut metas = scan_skills_dirs(&dirs);
    let mut seen: HashSet<String> = metas.iter().map(|m| m.name.clone()).collect();
    // `merge_bundled` 的语义:同名不覆盖(用户/工作区技能优先)。
    let mut bundled: HashSet<String> = HashSet::new();
    for b in bundled_skills() {
        if seen.insert(b.name.clone()) {
            bundled.insert(b.name.clone());
            metas.push(b);
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
