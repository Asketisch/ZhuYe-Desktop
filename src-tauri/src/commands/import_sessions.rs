//! v1.11 D9:外部 Agent 导入 —— 外部 harness 会话一键导入。
//!
//! 引擎侧 `zhuye-import` 的 adapter 已齐备(gap-report D9:
//! 「引擎有,GUI 无」),本命令把它们接进 Tauri 表:
//! - `zhuye_import_discover` —— 按种类列出可导入来源(不入库);
//! - `zhuye_import_sessions` —— 批量导入到本机 rollout base
//!   (`zhuye_rollout::path::default_base()`),`dry_run` 可预演。
//!
//! GUI 只暴露 claude_code / codex 两种来源;引擎其余 HarnessKind
//! 不在桌面端命令面开放。
//!
//! 导入后既有会话列表(zhuye_list_sessions / replay)自然看到新会话,
//! 无需额外注册动作。

use serde::Serialize;

use crate::commands::error::{CommandError, CommandResult};

fn parse_kind(kind: &str) -> CommandResult<zhuye_import::HarnessKind> {
    match kind {
        "claude_code" => Ok(zhuye_import::HarnessKind::ClaudeCode),
        "codex" => Ok(zhuye_import::HarnessKind::Codex),
        other => Err(CommandError {
            msg: format!("unknown harness kind `{other}`; expected claude_code | codex"),
        }),
    }
}

/// 一条可导入来源(camelCase 出线)。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceInfo {
    /// 展示描述(文件路径或 SQLite 库标识)。
    pub display: String,
}

/// 批量导入的统计(camelCase 出线)。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRunResult {
    pub imported: Vec<ImportOutcomeInfo>,
    pub failed: Vec<ImportFailureInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcomeInfo {
    pub source: String,
    pub thread_id: String,
    pub turns: usize,
    pub records: usize,
    /// 导出的 rollout JSONL 路径(dry_run 时为 null)。
    pub path: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailureInfo {
    pub source: String,
    pub error: String,
}

/// 列出某类 Harness 的全部可导入来源(只发现,不入库)。
#[tauri::command]
pub async fn zhuye_import_discover(kind: String) -> CommandResult<Vec<ImportSourceInfo>> {
    let parsed = parse_kind(&kind)?;
    let sources = zhuye_import::discover(parsed).map_err(|e| CommandError {
        msg: format!("discover {kind} sources failed: {e}"),
    })?;
    Ok(sources
        .iter()
        .map(|s| ImportSourceInfo {
            display: s.display(),
        })
        .collect())
}

/// 批量导入某类 Harness 的会话到本机 rollout base。
///
/// `dry_run = true` 时只解析统计、不写文件(预演)。单源失败不中断整批
/// (失败清单逐条返回)。`include_thinking` / `keep_injected` 透传引擎
/// ImportOptions(默认丢弃 thinking 与 Harness 注入行,语义见上游)。
#[tauri::command]
pub async fn zhuye_import_sessions(
    kind: String,
    force: Option<bool>,
    dry_run: Option<bool>,
    include_thinking: Option<bool>,
    keep_injected: Option<bool>,
) -> CommandResult<ImportRunResult> {
    let parsed = parse_kind(&kind)?;
    let sources = zhuye_import::discover(parsed).map_err(|e| CommandError {
        msg: format!("discover {kind} sources failed: {e}"),
    })?;
    let opts = zhuye_import::ImportOptions {
        include_thinking: include_thinking.unwrap_or(false),
        keep_injected: keep_injected.unwrap_or(false),
        include_sidechain: false,
    };
    let base = zhuye_rollout::path::default_base();
    let (ok, failed) = zhuye_import::import_all(
        &base,
        &sources,
        Some(parsed),
        &opts,
        force.unwrap_or(false),
        dry_run.unwrap_or(false),
    );
    Ok(ImportRunResult {
        imported: ok
            .into_iter()
            .map(|o| ImportOutcomeInfo {
                source: o.source,
                thread_id: o.thread_id.to_string(),
                turns: o.turns,
                records: o.records,
                path: o.path.map(|p| p.display().to_string()),
                warnings: o.warnings.iter().map(|w| w.to_string()).collect(),
            })
            .collect(),
        failed: failed
            .into_iter()
            .map(|(source, e)| ImportFailureInfo {
                source,
                error: e.to_string(),
            })
            .collect(),
    })
}
