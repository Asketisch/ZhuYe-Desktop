//! Approval allowlist —— per-prefix 白名单的**遗留**存储层。
//!
//! 当前状态（如实描述，避免按不存在的链路读代码）：
//! - 三条命令已注册（`reflect_load_allowlist` / `reflect_save_allowlist` /
//!   `reflect_check_allowlist`），但**没有任何消费面**：审批链路不查这张表，
//!   前端也没有调用方 —— 审批弹窗上的「始终允许」写的是权限规则
//!   （见 `commands/permissions.rs` 的 `reflect_add_permission_rule`），
//!   与本文件无关。
//! - 因此这里只是数据层：读写 `~/.zhuye/approval_allowlist.json`，
//!   以及按前缀判定。要在审批流程里启用它，需要同时补 UI 入口与
//!   `state/permissions.rs` 的 consult 点，并更新 `docs/CAPABILITIES.md`。

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::commands::error::{CommandError, CommandResult};

fn allowlist_path() -> Option<PathBuf> {
    reflect_app_core::paths::user_data_path(&["approval_allowlist.json"])
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Allowlist {
    pub prefixes: Vec<String>,
}

/// 读取白名单。文件不存在 = 空表；读不动或解析失败一律报错，
/// 不能回退成空表 —— 调用方随后整体保存就会把用户已有的规则清零。
fn read_allowlist() -> CommandResult<Allowlist> {
    let Some(path) = allowlist_path() else {
        return Ok(Allowlist {
            prefixes: Vec::new(),
        });
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| CommandError {
            msg: format!(
                "allowlist 文件解析失败: {} ({e})；修好该文件前不会覆盖它",
                path.display()
            ),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Allowlist {
            prefixes: Vec::new(),
        }),
        Err(error) => Err(CommandError::from(error)),
    }
}

fn write_allowlist(list: &Allowlist) -> Result<(), CommandError> {
    let path = allowlist_path().ok_or_else(|| CommandError {
        msg: "no HOME for allowlist".into(),
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(CommandError::from)?;
    }
    let json = serde_json::to_string_pretty(list).map_err(|e| CommandError {
        msg: format!("serialize allowlist: {e}"),
    })?;
    // 非原子写会留下半截 JSON，`read_allowlist` 解析失败后静默回退成空表 ——
    // 用户「始终允许」的规则会被清零。
    crate::persistence::write_atomic(&path, json.as_bytes()).map_err(CommandError::from)?;
    Ok(())
}

#[tauri::command]
pub async fn reflect_load_allowlist() -> CommandResult<Allowlist> {
    read_allowlist()
}

#[tauri::command]
pub async fn reflect_save_allowlist(list: Allowlist) -> CommandResult<()> {
    // 去重 + 排序 + 修剪空白 + 限制 1024 条。
    let mut set: BTreeSet<String> = BTreeSet::new();
    for p in list.prefixes {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            set.insert(trimmed.to_string());
        }
    }
    let mut deduped: Vec<String> = set.into_iter().collect();
    if deduped.len() > 1024 {
        deduped.truncate(1024);
    }
    let cleaned = Allowlist { prefixes: deduped };
    write_allowlist(&cleaned)?;
    Ok(())
}

#[tauri::command]
pub async fn reflect_check_allowlist(prefix: String) -> CommandResult<bool> {
    let list = read_allowlist()?;
    let target = prefix.trim();
    if target.is_empty() {
        return Ok(false);
    }
    Ok(list.prefixes.iter().any(|p| target.starts_with(p.as_str())))
}
