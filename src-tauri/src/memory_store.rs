//! Memory 存储 —— 将 memory entry 持久化到 `MEMORY.md` 文件。
//!
//! 支持两个 scope:
//! - `project` —— 存储在当前工作区根目录 `.reflect/agent-memory/<agent>/MEMORY.md`
//!   （由调用方传入活动工作区,与 shell/git/files 同源 —— 打包成 .app 后
//!   进程 cwd 不可写,也不再跟随不了 `reflect_set_workspace`）;
//! - `user` —— 存储在用户主目录 `~/.reflect/agent-memory/<agent>/MEMORY.md`。
//!
//! 每条 entry 以 `## <key>` 标题块形式追加到文件中。
//!
//! ## 路径口径
//!
//! 路径**经核心的 [`reflect_memory::resolve_path`] 解析**,与运行时
//! (`reflect-core` 的 pre_loop 注入)逐字一致 —— 关键是 `<agent>` 这一段
//! 由**活跃 agent 名**决定(`AgentState::active_agent()`)。此前桌面端
//! 写死 `agent-memory/reflect/`,而运行时按 agent 定义名读,两边对不上:
//! GUI 里编辑的记忆,agent 根本读不到。
//!
//! 旧版桌面端(agent 段写死 `reflect`)留下的数据在首次启动时迁移到当前
//! 活跃 agent 的目录(见 [`migrate_legacy_memory_dir`]),不丢用户数据。

use std::path::{Path, PathBuf};

use reflect_memory::{MemoryScope, resolve_path};

use crate::agent_state::AgentState;
use crate::commands::MemoryEntry;

/// 旧版桌面端写死的 agent 目录名(迁移源)。
const LEGACY_AGENT_DIR: &str = "reflect";

#[derive(Default)]
pub(crate) struct MemoryStore;

impl MemoryStore {
    /// 列出所有 scope 下的 memory 条目。
    pub(crate) fn list(&self, project_root: &Path) -> anyhow::Result<Vec<MemoryEntry>> {
        let mut entries = Vec::new();
        for (scope, path) in self.scopes(project_root)? {
            if let Ok(content) = std::fs::read_to_string(path) {
                if !content.trim().is_empty() {
                    entries.push(MemoryEntry {
                        scope: scope.to_string(),
                        key: "(all)".to_string(),
                        value: content,
                    });
                }
            }
        }
        Ok(entries)
    }

    /// 新增 memory entry。
    pub(crate) fn add(
        &self,
        scope: &str,
        key: &str,
        value: &str,
        project_root: &Path,
    ) -> anyhow::Result<()> {
        let path = self.path(scope, project_root)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut current = std::fs::read_to_string(&path).unwrap_or_default();
        if !current.is_empty() && !current.ends_with('\n') {
            current.push('\n');
        }
        current.push_str(&format!("\n## {key}\n{value}\n"));
        std::fs::write(path, current)?;
        Ok(())
    }

    pub(crate) fn remove(&self, scope: &str, key: &str, project_root: &Path) -> anyhow::Result<()> {
        let path = self.path(scope, project_root)?;
        if !path.exists() {
            return Ok(());
        }
        let current = std::fs::read_to_string(&path)?;
        // 整行精确匹配 `## <key>`:子串前缀匹配会让 key "a" 命中
        // "## about" 的块起点,误删别的条目。
        let heading = format!("## {key}");
        if let Some((start, line_end)) = find_exact_heading_line(&current, &heading) {
            let end = current[line_end..]
                .find("\n## ")
                .map(|index| line_end + index)
                .unwrap_or(current.len());
            let mut updated = String::with_capacity(current.len());
            updated.push_str(&current[..start]);
            updated.push_str(&current[end..]);
            std::fs::write(path, updated)?;
        }
        Ok(())
    }

    fn scopes(&self, project_root: &Path) -> anyhow::Result<[(&'static str, PathBuf); 2]> {
        Ok([
            ("project", self.path("project", project_root)?),
            ("user", self.path("user", project_root)?),
        ])
    }

    /// 解析某 scope 的 `MEMORY.md` 路径。
    ///
    /// 经核心的 `resolve_path` —— 与运行时 pre_loop 注入记忆的路径口径
    /// 逐字一致(同一 `<agent>` 段来源)。
    fn path(&self, scope: &str, project_root: &Path) -> anyhow::Result<PathBuf> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home dir"))?;
        let scope = match scope {
            "project" => MemoryScope::Project,
            "user" => MemoryScope::User,
            other => anyhow::bail!("unknown memory scope: {other}"),
        };
        let agent_type = AgentState::active_agent();
        resolve_path(scope, project_root, &home, &agent_type)
            .map_err(|e| anyhow::anyhow!("resolve memory path: {e}"))
    }
}

/// 旧版桌面端(agent 段写死 `reflect`)留下的记忆文件 → 当前活跃 agent 目录。
///
/// 只在**目标不存在、源存在**时迁移(move)—— 不覆盖用户新写的记忆。
/// 两个 scope 各迁一次;失败只记日志不阻断启动(记忆不是启动前提)。
pub(crate) fn migrate_legacy_memory_dir(project_root: &Path) {
    let active = AgentState::active_agent();
    if active == LEGACY_AGENT_DIR {
        return;
    }
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    for (scope, root) in [
        ("project", project_root.to_path_buf()),
        ("user", home.clone()),
    ] {
        let scope_enum = match scope {
            "project" => MemoryScope::Project,
            _ => MemoryScope::User,
        };
        let legacy = match resolve_path(scope_enum, &root, &home, LEGACY_AGENT_DIR) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let target = match resolve_path(scope_enum, &root, &home, &active) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !legacy.exists() || target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(error = %e, "创建迁移目标目录失败,跳过记忆迁移");
                continue;
            }
        }
        match std::fs::rename(&legacy, &target) {
            Ok(()) => tracing::info!(
                from = %legacy.display(),
                to = %target.display(),
                "已把旧版桌面端记忆迁移到当前活跃 agent 目录"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                from = %legacy.display(),
                to = %target.display(),
                "记忆迁移失败,保留原文件"
            ),
        }
    }
}

/// 在文本中查找整行恰为 `heading` 的行,返回 (行起始字节, 行尾字节,不含换行)。
fn find_exact_heading_line(text: &str, heading: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(rel) = text[from..].find(heading) {
        let start = from + rel;
        let at_line_start = start == 0 || text.as_bytes()[start - 1] == b'\n';
        let line_end = text[start..]
            .find('\n')
            .map(|i| start + i)
            .unwrap_or(text.len());
        if at_line_start && text[start..line_end].trim_end() == heading {
            return Some((start, line_end));
        }
        from = start + heading.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::find_exact_heading_line;
    use super::*;

    #[test]
    fn exact_line_match_rejects_prefix_and_extension() {
        let text = "## about\nabout body\n## a\na body\n";
        // key "a" 不能命中 "## about" 的前缀。
        assert_eq!(find_exact_heading_line(text, "## a"), Some((20, 24)));
        assert_eq!(find_exact_heading_line(text, "## about"), Some((0, 8)));
        assert_eq!(find_exact_heading_line(text, "## missing"), None);
    }

    /// 不变量:GUI 写记忆的路径 == 运行时 pre_loop 注入记忆读的路径。
    ///
    /// 两者都经核心的 `resolve_path` + 同一个活跃 agent 名 —— 此前 GUI 写
    /// 死 `agent-memory/reflect/`、运行时读 `agent-memory/<agent>/`，
    /// 导致「GUI 里编辑的记忆,agent 根本读不到」。
    #[test]
    fn memory_path_matches_core_resolution() {
        let ws = PathBuf::from("/tmp/reflect-memory-path-test");
        let home = dirs::home_dir().unwrap_or_default();
        let agent = AgentState::active_agent();
        let store = MemoryStore;
        for (scope, enum_scope) in [
            ("project", MemoryScope::Project),
            ("user", MemoryScope::User),
        ] {
            let expected = resolve_path(enum_scope, &ws, &home, &agent).unwrap();
            let actual = store.path(scope, &ws).unwrap();
            assert_eq!(actual, expected, "{scope} scope 路径与核心不一致");
        }
    }

    /// 旧版桌面端遗留的 `agent-memory/reflect/` 数据在迁移后不再被读取 ——
    /// 迁移把文件搬到了当前活跃 agent 的目录。
    #[test]
    fn legacy_dir_is_not_the_active_path() {
        let ws = PathBuf::from("/tmp/reflect-memory-legacy-test");
        let home = dirs::home_dir().unwrap_or_default();
        let active = AgentState::active_agent();
        if active == LEGACY_AGENT_DIR {
            // 活跃 agent 就是旧目录名 —— 无需迁移,路径天然一致。
            return;
        }
        let legacy = resolve_path(MemoryScope::Project, &ws, &home, LEGACY_AGENT_DIR).unwrap();
        let current = resolve_path(MemoryScope::Project, &ws, &home, &active).unwrap();
        assert_ne!(legacy, current);
    }
}
