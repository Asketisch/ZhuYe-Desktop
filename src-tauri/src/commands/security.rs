//! 安全扫描命令面 —— `cargo audit` 的一次性诊断。
//!
//! 核心的 `reflect_integration::security_scan::run_cargo_audit` 是**真实
//! 实现**(带 30s 超时 + 管道排空,任何 IO 错误都落到结构化报告,不 panic)。
//! 此前 GUI 完全没有这个面 —— 用户只能自己开终端跑。
//!
//! 诊断路径有界:cargo-audit 冷启动要拉 RustSec advisory DB(网络),
//! 离线 / 出口受限环境会无限阻塞 —— 核心的超时是硬约束,这里不覆盖它。

use std::path::PathBuf;

use reflect_integration::security_scan::SecurityScanReport;
use serde::Serialize;
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

/// 安全扫描报告(camelCase 出线)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityScanResult {
    /// 是否找到 cargo-audit 并成功执行。
    pub ran: bool,
    /// 进程 exit code(未运行时 null)。
    pub exit_code: Option<i32>,
    /// stdout + stderr 合并输出(截断至 64 KiB)。
    pub output: String,
    /// 人类可读摘要。
    pub summary: String,
}

impl From<SecurityScanReport> for SecurityScanResult {
    fn from(r: SecurityScanReport) -> Self {
        Self {
            ran: r.ran,
            exit_code: r.exit_code,
            output: r.output,
            summary: r.summary,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security_scan_report_conversion_preserves_wire_fields() {
        let report = SecurityScanReport {
            ran: true,
            exit_code: Some(1),
            output: "vulnerability output".into(),
            summary: "cargo audit 完成(exit 1)".into(),
        };
        let result = SecurityScanResult::from(report);
        assert!(result.ran);
        assert_eq!(result.exit_code, Some(1));
        assert_eq!(result.output, "vulnerability output");
        assert!(result.summary.contains("exit 1"));
    }
}

/// 在当前工作区跑一次 `cargo audit`(有界超时)。
///
/// 阻塞调用(可能跑 30s)→ 放进 `spawn_blocking`,不占住 async worker。
#[tauri::command]
pub async fn reflect_run_security_scan(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<SecurityScanResult> {
    let workspace: PathBuf = agent.workspace();
    let report = tokio::task::spawn_blocking(move || {
        reflect_integration::security_scan::run_cargo_audit(Some(&workspace))
    })
    .await
    .map_err(|e| super::error::CommandError {
        msg: format!("security scan task failed: {e}"),
    })?;
    Ok(report.into())
}
