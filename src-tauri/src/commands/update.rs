//! 更新检查(release manifest 探测)。

use serde::{Deserialize, Serialize};

use crate::commands::error::CommandResult;

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

/// Default release manifest endpoint. 可通过 env `REFLECT_UPDATE_URL` 覆盖。
const DEFAULT_UPDATE_URL: &str =
    "https://api.github.com/repos/Asketisch/ReflectDesktop/releases/latest";
/// Release manifest 的响应体上限；GitHub release 说明可能很长，但
/// 16 MiB 已远超正常 JSON，防止错误更新源占用无界内存。
const UPDATE_RESPONSE_MAX: u64 = 16 * 1024 * 1024;

#[tauri::command]
pub async fn reflect_check_update() -> CommandResult<UpdateInfo> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url =
        std::env::var("REFLECT_UPDATE_URL").unwrap_or_else(|_| DEFAULT_UPDATE_URL.to_string());

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
