//! Markdown grep / 全仓库查找（`reflect_search_files`）。
//!
//! 复用 `files::should_skip` 来过滤目录。

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::commands::files::should_skip;
use crate::state::MinimalAgent;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSearchHit {
    pub path: String,
    pub line: usize,
    pub context: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSearchResult {
    pub root: String,
    pub query: String,
    pub hits: Vec<FileSearchHit>,
    pub truncated: bool,
}

/// 搜索排序方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchRank {
    /// 子串匹配(默认,快)。
    #[default]
    Substring,
    /// BM25 相关性排序 —— 与 agent 自己的 grep 工具**同款**(`k1=1.2`,
    /// `b=0.75`),结果按相关性而非文件顺序。
    Bm25,
}

/// BM25 参数 —— 与核心 `reflect-tools` 的 grep 工具一致。
const BM25_K1: f64 = 1.2;
const BM25_B: f64 = 0.75;

/// BM25 候选行上限(防止超大仓库把内存吃满)。
const BM25_CANDIDATE_LIMIT: usize = 20_000;

#[tauri::command]
pub async fn reflect_search_files(
    agent: State<'_, MinimalAgent>,
    query: String,
    path: Option<String>,
    max_results: Option<usize>,
    rank: Option<SearchRank>,
) -> CommandResult<FileSearchResult> {
    let root = match path.as_deref() {
        Some("") | None => agent.workspace().to_path_buf(),
        Some(p) => {
            let pp = Path::new(p);
            if pp.is_absolute() {
                pp.to_path_buf()
            } else {
                agent.workspace().join(pp)
            }
        }
    };
    if !root.exists() {
        return Err(CommandError {
            msg: format!("path does not exist: {}", root.display()),
        });
    }
    let cap = max_results.unwrap_or(200);
    if rank.unwrap_or_default() == SearchRank::Bm25 {
        return Ok(bm25_search(&root, &query, cap));
    }
    let mut hits = Vec::new();
    let mut truncated = false;
    search_walk(&root, &query, cap, &mut hits, &mut truncated);
    Ok(FileSearchResult {
        root: root.display().to_string(),
        query,
        hits,
        truncated,
    })
}

/// BM25 相关性搜索 —— 复用核心 `reflect_tools::bm25` 的实现
/// (与 agent 的 grep 工具同源,同一份分词 + 排序)。
fn bm25_search(root: &Path, query: &str, cap: usize) -> FileSearchResult {
    let terms = reflect_tools::bm25::tokenize(query);
    let mut candidates: Vec<(String, usize, String)> = Vec::new();
    if !terms.is_empty() {
        collect_candidates(root, &terms, &mut candidates);
    }
    // 候选行号用**全局下标**占位,排序后再映射回 (文件, 行号)。
    let pairs: Vec<(usize, String)> = candidates
        .iter()
        .enumerate()
        .map(|(i, (_, _, line))| (i, line.clone()))
        .collect();
    let ranked = reflect_tools::bm25::rank_lines(&terms, &pairs, BM25_K1, BM25_B);
    let hits: Vec<FileSearchHit> = ranked
        .into_iter()
        .take(cap)
        .map(|h| {
            let (file, line_no, _) = &candidates[h.line_no];
            FileSearchHit {
                path: file.clone(),
                line: *line_no,
                context: h.line.chars().take(240).collect(),
            }
        })
        .collect();
    FileSearchResult {
        root: root.display().to_string(),
        query: query.to_string(),
        hits,
        // 候选被截断时如实标记。
        truncated: candidates.len() >= BM25_CANDIDATE_LIMIT,
    }
}

/// 递归收集含任一查询词的行(BM25 的候选集)。
fn collect_candidates(dir: &Path, terms: &[String], candidates: &mut Vec<(String, usize, String)>) {
    if candidates.len() >= BM25_CANDIDATE_LIMIT {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = read.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if candidates.len() >= BM25_CANDIDATE_LIMIT {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip(&name) {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            collect_candidates(&path, terms, candidates);
        } else if meta.is_file() && meta.len() < 512 * 1024 {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (i, line) in content.lines().enumerate() {
                let lower = line.to_lowercase();
                if terms.iter().any(|t| lower.contains(t.as_str())) {
                    candidates.push((path.display().to_string(), i + 1, line.to_string()));
                    if candidates.len() >= BM25_CANDIDATE_LIMIT {
                        return;
                    }
                }
            }
        }
    }
}

pub(crate) fn search_walk(
    dir: &Path,
    query: &str,
    cap: usize,
    hits: &mut Vec<FileSearchHit>,
    truncated: &mut bool,
) {
    if hits.len() >= cap {
        *truncated = true;
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = read.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if hits.len() >= cap {
            *truncated = true;
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip(&name) {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            search_walk(&path, query, cap, hits, truncated);
        } else if meta.is_file() && meta.len() < 512 * 1024 {
            search_file(&path, query, hits, cap, truncated);
        }
    }
}

pub(crate) fn search_file(
    path: &Path,
    query: &str,
    hits: &mut Vec<FileSearchHit>,
    cap: usize,
    truncated: &mut bool,
) {
    if hits.len() >= cap {
        *truncated = true;
        return;
    }
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    for (i, line) in content.lines().enumerate() {
        if hits.len() >= cap {
            *truncated = true;
            return;
        }
        if line.to_lowercase().contains(&query.to_lowercase()) {
            hits.push(FileSearchHit {
                path: path.display().to_string(),
                line: i + 1,
                context: line.chars().take(240).collect(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_file_basic() {
        let dir = tempdir();
        let p = dir.join("sample.rs");
        std::fs::write(&p, "fn main() {\n    println!(\"hi\");\n}\n").unwrap();
        let mut hits = Vec::new();
        let mut truncated = false;
        search_file(&p, "println", &mut hits, 10, &mut truncated);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert!(!truncated);
    }

    #[test]
    fn search_walk_skips_target() {
        let dir = tempdir();
        std::fs::create_dir_all(dir.join("target")).unwrap();
        std::fs::write(dir.join("target/ignored.rs"), "println!();").unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/main.rs"), "fn main() { }").unwrap();
        let mut hits = Vec::new();
        let mut truncated = false;
        search_walk(&dir, "main", 10, &mut hits, &mut truncated);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("src/main.rs"));
    }

    fn tempdir() -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("reflect-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        base
    }
}
