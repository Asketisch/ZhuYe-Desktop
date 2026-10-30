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
