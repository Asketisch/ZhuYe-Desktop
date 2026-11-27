//! 更新检查(release manifest 探测)。

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::commands::error::{CommandError, CommandResult};

/// 更新信息(camelCase 出线,遵循桌面端 DTO 约定)。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 当前应用版本。
    pub current_version: String,
    /// 最新发布版本;探测失败时为 `None`。
    pub latest_version: Option<String>,
    /// 是否存在比当前版本更新的发布。
    pub update_available: bool,
    /// 发布页 URL(有更新时可打开)。
    pub release_url: Option<String>,
    /// 发布说明正文。
    pub release_notes: Option<String>,
    /// 探测时间(epoch 秒)。
    pub probed_at: i64,
    /// 探测错误(离线 / 非 200);不阻断 UI。
    pub error: Option<String>,
}

/// Default release manifest endpoint. 可通过 env `ZHUYE_UPDATE_URL` 覆盖。
const DEFAULT_UPDATE_URL: &str =
    "https://api.github.com/repos/Asketisch/ZhuYe-Desktop/releases/latest";
/// Release manifest 的响应体上限；GitHub release 说明可能很长，但
/// 16 MiB 已远超正常 JSON，防止错误更新源占用无界内存。
const UPDATE_RESPONSE_MAX: u64 = 16 * 1024 * 1024;

#[tauri::command]
pub async fn zhuye_check_update() -> CommandResult<UpdateInfo> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = std::env::var("ZHUYE_UPDATE_URL").unwrap_or_else(|_| DEFAULT_UPDATE_URL.to_string());

    // 离线失败时不破坏 UI —— 返回 Ok(没有 update),附 error 给 toast 看。
    match probe_release(&url).await {
        Ok((tag, html_url, notes)) => {
            let latest = tag.trim_start_matches('v').to_string();
            let upd = compare_versions(&latest, &current);
            Ok(UpdateInfo {
                current_version: current,
                latest_version: Some(latest),
                update_available: upd,
                release_url: html_url,
                release_notes: notes,
                probed_at: now,
                error: None,
            })
        }
        Err(e) => Ok(UpdateInfo {
            current_version: current,
            latest_version: None,
            update_available: false,
            release_url: None,
            release_notes: None,
            probed_at: now,
            error: Some(e.to_string()),
        }),
    }
}

async fn probe_release(url: &str) -> anyhow::Result<(String, Option<String>, Option<String>)> {
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        html_url: Option<String>,
        body: Option<String>,
    }

    // 继续沿用现有的 curl 探测,避免增加原生 TLS 依赖。
    let out = tokio::process::Command::new("curl")
        .args([
            "-fsSL",
            "--max-time",
            "8",
            "-H",
            "Accept: application/vnd.github+json",
            url,
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("spawn curl: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(anyhow::anyhow!("release probe failed: {stderr}"));
    }
    if out.stdout.len() as u64 > UPDATE_RESPONSE_MAX {
        return Err(anyhow::anyhow!(
            "release manifest exceeds {UPDATE_RESPONSE_MAX} byte limit"
        ));
    }
    let json = String::from_utf8_lossy(&out.stdout).into_owned();
    let rel: Release =
        serde_json::from_str(&json).map_err(|e| anyhow::anyhow!("parse release json: {e}"))?;
    Ok((rel.tag_name, rel.html_url, rel.body))
}

fn compare_versions(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> { s.split('.').filter_map(|p| p.parse().ok()).collect() };
    let l = parse(latest);
    let c = parse(current);
    l > c
}

// ===== 自更新（OTA）:tauri-plugin-updater 命令面 =====

/// `zhuye_update_progress` 事件负载（tag = "type",camelCase 出线）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum UpdateProgressPayload {
    /// 开始下载。
    Started,
    /// 下载中。
    Progress {
        /// 已下载字节。
        downloaded: u64,
        /// 总字节（unknown 时为 null）。
        total: Option<u64>,
    },
    /// 下载完成，安装已执行（等待重启生效）。
    Finished,
}

/// 自更新安装结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallOutcome {
    /// 是否找到并安装了更新（false = 已是最新，无需重启）。
    pub installed: bool,
    /// 安装的目标版本（installed=false 时为 null）。
    pub version: Option<String>,
    /// 更新说明正文（release notes）。
    pub notes: Option<String>,
}

/// 检查 → 下载 → 安装更新（一条命令走完整回路）。
///
/// 进度经 `zhuye_update_progress` 事件推前端（Started / Progress / Finished）；
/// 安装成功后由前端引导调用 `zhuye_relaunch_app` 生效。签名校验由
/// tauri-plugin-updater 按 `tauri.conf.json > plugins.updater.pubkey` 强制 ——
/// 未配置密钥或端点时返回结构化错误（不 panic、不静默）。
#[tauri::command]
pub async fn zhuye_download_install_update(
    agent: tauri::State<'_, crate::state::MinimalAgent>,
) -> CommandResult<UpdateInstallOutcome> {
    // 应用句柄从托管状态取（而非直接当参数）—— 与其他 OS 交互命令同款：
    // mock runtime 下句柄缺失返回结构化错误，能力覆盖层可驱动真实命令体。
    let app = agent.app_handle().ok_or_else(|| CommandError {
        msg: "应用句柄未就绪，无法执行更新".to_string(),
    })?;

    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater_builder().build().map_err(|e| CommandError {
        msg: format!("updater 初始化失败: {e}"),
    })?;
    let update = updater.check().await.map_err(|e| CommandError {
        msg: format!("updater 检查失败: {e}"),
    })?;
    let Some(update) = update else {
        // 已是最新 —— 不发事件，直接返回。
        return Ok(UpdateInstallOutcome {
            installed: false,
            version: None,
            notes: None,
        });
    };

    let _ = app.emit("zhuye_update_progress", UpdateProgressPayload::Started);
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let finish_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_app.emit(
                    "zhuye_update_progress",
                    UpdateProgressPayload::Progress { downloaded, total },
                );
            },
            move || {
                let _ = finish_app.emit("zhuye_update_progress", UpdateProgressPayload::Finished);
            },
        )
        .await
        .map_err(|e| CommandError {
            msg: format!("更新下载/安装失败: {e}"),
        })?;

    Ok(UpdateInstallOutcome {
        installed: true,
        version: Some(update.version),
        notes: update.body,
    })
}

/// 重启应用（更新安装完成后生效）。
///
/// 用 tauri 核心 `request_restart`（非阻塞变体）：置位 restart_on_exit 后请求
/// 事件循环退出，进程由 run loop 干净替换 —— 比 `restart()` 更适合命令层
/// （`restart()` 在非主线程会 `sleep(Duration::MAX)` 永久阻塞工作线程）。
#[tauri::command]
pub async fn zhuye_relaunch_app(
    agent: tauri::State<'_, crate::state::MinimalAgent>,
) -> CommandResult<()> {
    let app = agent.app_handle().ok_or_else(|| CommandError {
        msg: "应用句柄未就绪，无法重启".to_string(),
    })?;
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::compare_versions;

    #[test]
    fn compare_versions_basic() {
        assert!(compare_versions("0.2.0", "0.1.0"));
        assert!(!compare_versions("0.1.0", "0.1.0"));
        assert!(!compare_versions("0.1.0", "0.2.0"));
    }
}
