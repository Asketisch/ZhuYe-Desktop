//! 知识管理系统(KMS)命令。
//!
//! 基于 grep 的 wiki + /dream 会话挖掘。
//! 包装 `reflect_kms::KnowledgeManager`。

use reflect_kms::{DreamResult, KmsError, Page, SearchResult, WikiInfo};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

impl From<KmsError> for CommandError {
    fn from(e: KmsError) -> Self {
        CommandError { msg: e.to_string() }
    }
}

/// 列出所有知识库。
#[tauri::command]
pub async fn reflect_kms_list(agent: State<'_, MinimalAgent>) -> CommandResult<Vec<WikiInfo>> {
    agent.kms_manager().list_wikis().map_err(CommandError::from)
}

/// 创建一个新的知识库。
#[tauri::command]
pub async fn reflect_kms_create(
    agent: State<'_, MinimalAgent>,
    name: String,
    description: Option<String>,
) -> CommandResult<WikiInfo> {
    agent
        .kms_manager()
        .create_wiki(&name, description)
        .map_err(CommandError::from)
}

/// 删除一个知识库。
#[tauri::command]
pub async fn reflect_kms_delete(agent: State<'_, MinimalAgent>, name: String) -> CommandResult<()> {
    agent
        .kms_manager()
        .delete_wiki(&name)
        .map_err(CommandError::from)
}

/// 在知识库中保存一个页面。
#[tauri::command]
#[allow(clippy::too_many_arguments)] // 保持现有平铺 IPC 负载。
pub async fn reflect_kms_save_page(
    agent: State<'_, MinimalAgent>,
    wiki: String,
    page: String,
    content: String,
    title: Option<String>,
    tags: Option<Vec<String>>,
    create_only: Option<bool>,
    expected_content: Option<String>,
) -> CommandResult<Page> {
    let manager = agent.kms_manager();
    let tags = tags.unwrap_or_default();
    if create_only.unwrap_or(false) && expected_content.is_some() {
        return Err(CommandError::from(
            "createOnly and expectedContent cannot be combined",
        ));
    }
    if create_only.unwrap_or(false) {
        manager.create_page(&wiki, &page, &content, title, tags)
    } else if let Some(expected) = expected_content {
        manager.save_page_if_unchanged(&wiki, &page, &content, title, tags, &expected)
    } else {
        manager.save_page(&wiki, &page, &content, title, tags)
    }
    .map_err(CommandError::from)
}

/// 从知识库读取一个页面。
#[tauri::command]
pub async fn reflect_kms_get_page(
    agent: State<'_, MinimalAgent>,
    wiki: String,
    page: String,
) -> CommandResult<Page> {
    agent
        .kms_manager()
        .get_page(&wiki, &page)
        .map_err(CommandError::from)
}

/// 列出知识库中的所有页面。
#[tauri::command]
pub async fn reflect_kms_list_pages(
    agent: State<'_, MinimalAgent>,
    wiki: String,
) -> CommandResult<Vec<Page>> {
    agent
        .kms_manager()
        .list_pages(&wiki)
        .map_err(CommandError::from)
}

/// 在所有知识库内搜索。
#[tauri::command]
pub async fn reflect_kms_search(
    agent: State<'_, MinimalAgent>,
    query: String,
) -> CommandResult<Vec<SearchResult>> {
    agent
        .kms_manager()
        .search(&query)
        .map_err(CommandError::from)
}

/// 运行一次 /dream 会话 —— 从最近的会话中抽取洞察。
#[tauri::command]
pub async fn reflect_dream(
    agent: State<'_, MinimalAgent>,
    insights: Vec<String>,
    sessions_analyzed: usize,
) -> CommandResult<DreamResult> {
    agent
        .kms_manager()
        .dream(insights, sessions_analyzed)
        .map_err(CommandError::from)
}
