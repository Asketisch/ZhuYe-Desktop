//! DAG 流水线命令面。
//!
//! 薄包装 `reflect_app_core::pipeline`,GUI 对应 CLI `reflect pipeline`:
//! team 四阶段预设(plan → prd → exec → verify)与 TOML DAG 配置两条入口。
//! 共享 `~/.zhuye/tasks|teams/` 存储(与 Squad / Tasks 视图同源)。

use std::collections::HashMap;
use std::path::PathBuf;

use reflect_app_core::pipeline::PipelineRunError;
use reflect_pipeline::PipelineReport;
use serde::Serialize;
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

impl From<PipelineRunError> for super::error::CommandError {
    fn from(e: PipelineRunError) -> Self {
        super::error::CommandError { msg: e.to_string() }
    }
}

/// 用已注册 team 跑四阶段预设 pipeline(plan → prd → exec → verify)。
#[tauri::command]
pub async fn reflect_run_team_pipeline(
    agent: State<'_, MinimalAgent>,
    team_name: String,
    topic: String,
) -> CommandResult<PipelineReport> {
    let manager = agent.task_manager();
    Ok(reflect_app_core::pipeline::run_team_pipeline(manager, &team_name, &topic).await?)
}

/// 读 TOML DAG 配置跑任意拓扑(对应 CLI `reflect pipeline run -c`)。
#[tauri::command]
pub async fn reflect_run_pipeline(
    agent: State<'_, MinimalAgent>,
    config_path: String,
    topic: String,
    failure_policy: Option<String>,
    inputs: Option<HashMap<String, String>>,
) -> CommandResult<PipelineReport> {
    let manager = agent.task_manager();
    Ok(reflect_app_core::pipeline::run_pipeline_config(
        manager,
        std::path::Path::new(&config_path),
        &topic,
        failure_policy.as_deref(),
        inputs.unwrap_or_default(),
    )
    .await?)
}

/// 校验一段 pipeline TOML(编辑器实时反馈)。
#[tauri::command]
pub async fn reflect_validate_pipeline(
    agent: State<'_, MinimalAgent>,
    toml_src: String,
) -> CommandResult<reflect_app_core::pipeline::PipelineConfigSummary> {
    let manager = agent.task_manager();
    Ok(reflect_app_core::pipeline::validate_pipeline_config(manager, &toml_src).await?)
}

/// pipeline 配置的存放目录(`~/.zhuye/pipelines/`)。
fn pipelines_dir() -> Option<PathBuf> {
    reflect_config::paths::data_path(&["pipelines"])
}

/// 列出已保存的 pipeline 配置。
#[tauri::command]
pub async fn reflect_list_pipeline_configs() -> CommandResult<Vec<PipelineConfigFile>> {
    let Some(dir) = pipelines_dir() else {
        return Ok(Vec::new());
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<PipelineConfigFile> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some("toml") {
                return None;
            }
            let name = path.file_stem()?.to_string_lossy().to_string();
            let toml_src = std::fs::read_to_string(&path).ok()?;
            Some(PipelineConfigFile {
                name,
                path: path.display().to_string(),
                toml: toml_src,
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 保存一个 pipeline 配置(写到 `~/.zhuye/pipelines/<name>.toml`)。
///
/// 写前先跑一次核心校验 —— 非法配置**不落盘**(避免存下跑不起来的拓扑)。
#[tauri::command]
pub async fn reflect_save_pipeline_config(
    agent: State<'_, MinimalAgent>,
    name: String,
    toml_src: String,
) -> CommandResult<PipelineConfigFile> {
    let key = name.trim();
    if key.is_empty() {
        return Err(super::error::CommandError {
            msg: "pipeline name cannot be empty".into(),
        });
    }
    if key.contains('/') || key.contains('\\') || key.contains('\0') || key == ".." {
        return Err(super::error::CommandError {
            msg: format!("pipeline name contains invalid characters: {name:?}"),
        });
    }
    // 校验(与运行同一条路径)—— 不合法不落盘。
    let summary =
        reflect_app_core::pipeline::validate_pipeline_config(agent.task_manager(), &toml_src)
            .await?;
    if !summary.valid {
        return Err(super::error::CommandError {
            msg: format!(
                "invalid pipeline config: {}",
                summary.error.unwrap_or_else(|| "unknown error".into())
            ),
        });
    }
    let dir = pipelines_dir().ok_or_else(|| super::error::CommandError {
        msg: "no HOME dir for pipelines".into(),
    })?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{key}.toml"));
    crate::persistence::write_atomic(&path, toml_src.as_bytes())?;
    Ok(PipelineConfigFile {
        name: key.to_string(),
        path: path.display().to_string(),
        toml: toml_src,
    })
}

/// 一个已保存的 pipeline 配置(camelCase 出线)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineConfigFile {
    /// 配置名(文件名去扩展名)。
    pub name: String,
    /// 文件绝对路径。
    pub path: String,
    /// 文件内容(TOML 原文)。
    pub toml: String,
}
