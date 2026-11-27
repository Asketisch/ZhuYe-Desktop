//! Memory 存储 —— 将 memory entry 持久化到 `MEMORY.md` 文件。
//!
//! 支持两个 scope:
//! - `project` —— 存储在当前工作区根目录 `.zhuye/agent-memory/<agent>/MEMORY.md`
//!   （由调用方传入活动工作区,与 shell/git/files 同源 —— 打包成 .app 后
//!   进程 cwd 不可写,也不再跟随不了 `zhuye_set_workspace`）;
//! - `user` —— 存储在用户主目录 `~/.zhuye/agent-memory/<agent>/MEMORY.md`。
//!
//! 每条 entry 以 `## <key>` 标题块形式保存；无法安全拆分的文件作为整份文档编辑。
//!
//! ## 路径口径
//!
//! 路径**经核心的 [`zhuye_memory::resolve_path`] 解析**,与运行时
//! (`zhuye-core` 的 pre_loop 注入)逐字一致 —— 关键是 `<agent>` 这一段
//! 由**活跃 agent 名**决定(`AgentState::active_agent()`)。GUI 与运行时
//! 共用同一条解析,GUI 里编辑的记忆 agent 一定读得到。

use std::path::{Path, PathBuf};

use zhuye_memory::{MemoryScope, resolve_path, split_sections};

use crate::agent_state::AgentState;
use crate::commands::MemoryEntry;

#[derive(Default)]
pub(crate) struct MemoryStore;

impl MemoryStore {
    /// 对基于列表快照发起的修改校验原内容，避免覆盖较新的记忆。
    fn check_expected_value(
        scope: &str,
        key: &str,
        content: &str,
        whole_document: bool,
        expected: Option<&str>,
    ) -> anyhow::Result<()> {
        if let Some(expected) = expected {
            let matches = memory_entries(scope, content).into_iter().any(|entry| {
                entry.key == key
                    && entry.value == expected
                    && entry.whole_document.unwrap_or(false) == whole_document
            });
            if !matches {
                anyhow::bail!("memory entry changed or was removed; reload before retrying");
            }
        }
        Ok(())
    }

    /// 列出所有 scope 下的 memory 条目。
    pub(crate) fn list(&self, project_root: &Path) -> anyhow::Result<Vec<MemoryEntry>> {
        let mut entries = Vec::new();
        for (scope, path) in self.scopes(project_root)? {
            let content = read_memory_file(&path)?;
            entries.extend(memory_entries(scope, &content));
        }
        Ok(entries)
    }

    /// 按核心解析器拆分各文件，保留原始标题及文件内序号。
    pub(crate) fn sections(
        &self,
        project_root: &Path,
    ) -> anyhow::Result<Vec<zhuye_memory::MemorySection>> {
        let mut sections = Vec::new();
        for (scope, path) in self.scopes(project_root)? {
            let content = read_memory_file(&path)?;
            if !content.trim().is_empty() {
                sections.extend(split_sections(memory_scope(scope), &content));
            }
        }
        Ok(sections)
    }

    /// 新增 memory entry。
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn add(
        &self,
        scope: &str,
        key: &str,
        value: &str,
        project_root: &Path,
        replace_document: bool,
        create_only: bool,
        expected_value: Option<&str>,
    ) -> anyhow::Result<()> {
        validate_key(key)?;
        if replace_document && create_only {
            anyhow::bail!("cannot create a whole-document replacement");
        }
        let path = self.path(scope, project_root)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut current = read_memory_file(&path)?;
        Self::check_expected_value(scope, key, &current, replace_document, expected_value)?;
        if replace_document {
            ensure_whole_document(scope, key, &current)?;
            crate::persistence::write_atomic(&path, value.as_bytes())?;
            return Ok(());
        }
        if value.lines().any(|line| line.starts_with("## ")) {
            anyhow::bail!("memory value cannot contain a level-two heading");
        }
        if create_only
            && memory_entries(scope, &current)
                .iter()
                .any(|entry| entry.key == key)
        {
            anyhow::bail!("memory entry already exists: {key}");
        }
        let heading = format!("## {key}");
        let matching = split_sections(memory_scope(scope), &current)
            .iter()
            .filter(|section| section.title == key)
            .count();
        if matching > 0 && create_only {
            anyhow::bail!("memory entry already exists: {key}");
        }
        if matching > 1 || (matching == 1 && find_exact_heading_line(&current, &heading).is_none())
        {
            anyhow::bail!("memory entry has ambiguous headings: {key}");
        }
        if let Some((_start, line_end)) = find_exact_heading_line(&current, &heading) {
            let end = current[line_end..]
                .find("\n## ")
                .map_or(current.len(), |i| line_end + i);
            if find_exact_heading_line(&current[end..], &heading).is_some() {
                anyhow::bail!("memory entry has duplicate headings: {key}");
            }
            let updated = format!("{}\n{}{}", &current[..line_end], value, &current[end..]);
            crate::persistence::write_atomic(&path, updated.as_bytes())?;
            return Ok(());
        }
        if !current.is_empty() && !current.ends_with('\n') {
            current.push('\n');
        }
        current.push_str(&format!("\n## {key}\n{value}\n"));
        crate::persistence::write_atomic(&path, current.as_bytes())?;
        Ok(())
    }

    pub(crate) fn remove(
        &self,
        scope: &str,
        key: &str,
        project_root: &Path,
        replace_document: bool,
        expected_value: Option<&str>,
    ) -> anyhow::Result<()> {
        validate_key(key)?;
        let path = self.path(scope, project_root)?;
        let current = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && expected_value.is_none() =>
            {
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        Self::check_expected_value(scope, key, &current, replace_document, expected_value)?;
        if replace_document {
            ensure_whole_document(scope, key, &current)?;
            std::fs::remove_file(path)?;
            return Ok(());
        }
        // 整行精确匹配 `## <key>`:子串前缀匹配会让 key "a" 命中
        // "## about" 的块起点,误删别的条目。
        let heading = format!("## {key}");
        let matching = split_sections(memory_scope(scope), &current)
            .iter()
            .filter(|section| section.title == key)
            .count();
        if matching > 1 || (matching == 1 && find_exact_heading_line(&current, &heading).is_none())
        {
            anyhow::bail!("memory entry has ambiguous headings: {key}");
        }
        if let Some((start, line_end)) = find_exact_heading_line(&current, &heading) {
            let end = current[line_end..]
                .find("\n## ")
                .map_or(current.len(), |index| line_end + index);
            if find_exact_heading_line(&current[end..], &heading).is_some() {
                anyhow::bail!("memory entry has duplicate headings: {key}");
            }
            let mut updated = String::with_capacity(current.len());
            updated.push_str(&current[..start]);
            updated.push_str(&current[end..]);
            crate::persistence::write_atomic(&path, updated.as_bytes())?;
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

fn read_memory_file(path: &Path) -> anyhow::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}

fn validate_key(key: &str) -> anyhow::Result<()> {
    if key.is_empty() || key.trim() != key || key.contains('\n') || key.contains('\r') {
        anyhow::bail!("memory key must be a nonempty single line without surrounding whitespace");
    }
    Ok(())
}

fn memory_entries(scope: &str, content: &str) -> Vec<MemoryEntry> {
    if content.trim().is_empty() {
        return Vec::new();
    }
    let sections: Vec<_> = split_sections(memory_scope(scope), content)
        .into_iter()
        .filter(|section| !section.title.is_empty() || !section.body.trim().is_empty())
        .collect();
    let mut keys = std::collections::HashSet::new();
    let malformed_heading = content
        .lines()
        .filter_map(|line| line.strip_prefix("## "))
        .any(|title| title.is_empty() || title.trim() != title);
    if malformed_heading
        || sections
            .iter()
            .any(|section| section.title.is_empty() || !keys.insert(section.title.clone()))
    {
        return vec![MemoryEntry {
            scope: scope.to_string(),
            key: "(all)".into(),
            value: content.to_string(),
            whole_document: Some(true),
        }];
    }
    sections
        .into_iter()
        .map(|section| {
            let heading = format!("## {}", section.title);
            let (_, line_end) =
                find_exact_heading_line(content, &heading).expect("validated heading");
            let end = content[line_end..]
                .find("\n## ")
                .map_or(content.len(), |i| line_end + i);
            let body = if end > line_end {
                &content[line_end + 1..end]
            } else {
                ""
            };
            MemoryEntry {
                scope: scope.to_string(),
                key: section.title,
                value: body.to_string(),
                whole_document: None,
            }
        })
        .collect()
}

fn memory_scope(scope: &str) -> MemoryScope {
    if scope == "project" {
        MemoryScope::Project
    } else {
        MemoryScope::User
    }
}

fn ensure_whole_document(scope: &str, key: &str, content: &str) -> anyhow::Result<()> {
    let entries = memory_entries(scope, content);
    if key != "(all)" || entries.len() != 1 || entries[0].whole_document != Some(true) {
        anyhow::bail!("memory document changed; reload before replacing it");
    }
    Ok(())
}

/// 在文本中查找整行恰为 `heading` 的行,返回 (行起始字节, 行尾字节,不含换行)。
fn find_exact_heading_line(text: &str, heading: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(rel) = text[from..].find(heading) {
        let start = from + rel;
        let at_line_start = start == 0 || text.as_bytes()[start - 1] == b'\n';
        let line_end = text[start..].find('\n').map_or(text.len(), |i| start + i);
        if at_line_start && text[start..line_end].trim_end() == heading {
            return Some((start, line_end));
        }
        from = start + heading.len();
    }
    None
}

#[cfg(test)]
mod tests;
