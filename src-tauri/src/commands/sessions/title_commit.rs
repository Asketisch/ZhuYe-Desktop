//! 校验异步标题生成结果仍属于当前会话后再落盘。

use std::path::Path;
use std::sync::Arc;

use reflect_protocol::ThreadId;

use super::{
    CommandError, CommandResult, MinimalAgent, custom_names, extract_title_seed, replay_session,
};
use crate::state::recorder_guard::RecorderGate;

pub(super) async fn commit(
    agent: &MinimalAgent,
    base: &Path,
    id: ThreadId,
    expected_user: &str,
    force: bool,
    title: &str,
    gate: &Arc<RecorderGate>,
) -> CommandResult<String> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    let _operation = gate.acquire().await.map_err(CommandError::from)?;
    let records = replay_session(base, &id)
        .await
        .map_err(CommandError::from)?;
    if extract_title_seed(&records).0.as_deref() != Some(expected_user) {
        return Err(CommandError {
            msg: "Session changed while generating its title".into(),
        });
    }
    if let Some(name) = custom_names(base).get(&id.to_string()) {
        return Ok(name.clone());
    }
    let path = base.join("_titles").join(format!("{id}.title"));
    // 同 `_names`：链接位必须先验，否则写标题变成写外部文件。
    super::sidecar::reject_links(&path)?;
    if !force && let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Ok(existing.to_string());
        }
    }
    // 桌面端自有原子写（核心已移除该写入）：预检链接位 + 同目录临时文件
    // + rename 替换，消除半截文件与链接写穿两个窗口。
    super::sidecar::write_session_sidecar(base, id, "title", title.as_bytes())
        .map_err(CommandError::from)?;
    Ok(title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_protocol::{MessageRole, RolloutRecord, TurnId};

    fn session(base: &Path, id: ThreadId) {
        let record = RolloutRecord::Message {
            turn_id: TurnId::new(),
            role: MessageRole::User,
            content: serde_json::json!("initial message"),
        };
        std::fs::write(
            base.join(format!("{id}.jsonl")),
            format!("{}\n", serde_json::to_string(&record).unwrap()),
        )
        .unwrap();
    }

    #[tokio::test]
    async fn deleted_session_does_not_receive_a_late_title() {
        let root = tempfile::tempdir().unwrap();
        let agent = MinimalAgent::new_empty();
        let id = ThreadId::new();
        session(root.path(), id);
        let gate = crate::state::recorder_guard::gate_for(&agent, id);
        crate::state::recorder_guard::deactivate_session(&agent, id).await;
        std::fs::remove_file(root.path().join(format!("{id}.jsonl"))).unwrap();
        assert!(
            commit(
                &agent,
                root.path(),
                id,
                "initial message",
                false,
                "late title",
                &gate
            )
            .await
            .is_err()
        );
        assert!(!root.path().join("_titles").exists());
    }

    #[tokio::test]
    async fn manually_renamed_session_keeps_its_name() {
        let root = tempfile::tempdir().unwrap();
        let agent = MinimalAgent::new_empty();
        let id = ThreadId::new();
        session(root.path(), id);
        let gate = crate::state::recorder_guard::gate_for(&agent, id);
        reflect_rollout::index::rename_session(root.path(), id, "manual").unwrap();
        assert_eq!(
            commit(
                &agent,
                root.path(),
                id,
                "initial message",
                false,
                "generated",
                &gate
            )
            .await
            .unwrap(),
            "manual"
        );
        assert!(!root.path().join("_titles").exists());
    }

    #[tokio::test]
    async fn changed_source_is_rejected_and_unchanged_source_is_saved() {
        let root = tempfile::tempdir().unwrap();
        let agent = MinimalAgent::new_empty();
        let id = ThreadId::new();
        session(root.path(), id);
        let gate = crate::state::recorder_guard::gate_for(&agent, id);
        assert!(
            commit(
                &agent,
                root.path(),
                id,
                "old message",
                false,
                "stale",
                &gate
            )
            .await
            .is_err()
        );
        assert_eq!(
            commit(
                &agent,
                root.path(),
                id,
                "initial message",
                false,
                "generated",
                &gate
            )
            .await
            .unwrap(),
            "generated"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("_titles").join(format!("{id}.title")))
                .unwrap(),
            "generated"
        );
    }
}
