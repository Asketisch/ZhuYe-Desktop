//! 会话名称写入与会话生命周期操作协调。

use std::path::Path;

use reflect_protocol::ThreadId;

use super::{CommandError, CommandResult, MinimalAgent, rollout_index};

pub(super) async fn rename(
    agent: &MinimalAgent,
    base: &Path,
    id: ThreadId,
    name: &str,
) -> CommandResult<()> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    // sidecar 是符号链接时拒绝：核心的写入按路径打开，会跟随链接写到工作区外。
    super::sidecar::reject_links(&base.join("_names").join(format!("{id}.name")))?;
    // 预分配会话不落盘(见 sessions.rs::reflect_create_session),全新 HOME 下
    // `_names` 及其父目录可能尚不存在;rollout 侧 write_session_sidecar 只做
    // 单级 create_dir,缺父目录即 ENOENT(macOS CI 稳定复现)。这里兜底
    // 建齐目录链后再交由核心写入 —— create_dir_all 对已存在目录是 no-op,
    // 符号链接已由上方 reject_links 拦截。
    std::fs::create_dir_all(base.join("_names")).map_err(CommandError::from)?;
    rollout_index::rename_session(base, id, name).map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rename_waits_for_session_lifecycle_operation() {
        let agent = MinimalAgent::new_empty();
        let dir = tempfile::tempdir().unwrap();
        let id = ThreadId::new();
        let transition = agent.inner.session_transition_lock.lock().await;
        let task = {
            let agent = agent.clone();
            let base = dir.path().to_path_buf();
            tokio::spawn(async move { rename(&agent, &base, id, "name").await })
        };
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        assert!(!dir.path().join("_names").exists());
        drop(transition);
        task.await.unwrap().unwrap();
        assert_eq!(
            rollout_index::read_session_name(dir.path(), id)
                .unwrap()
                .as_deref(),
            Some("name")
        );
    }
}
