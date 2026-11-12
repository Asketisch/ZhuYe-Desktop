//! 讨论历史不应包含没有讨论记录的普通会话。
mod common;

use chrono::Utc;
use reflect_protocol::{RolloutRecord, ThreadId};
use serde_json::json;

#[test]
fn discussion_history_filters_out_ordinary_sessions() {
    common::init_isolated_env();
    let base = reflect_rollout::path::default_base().join("2026/06/18");
    std::fs::create_dir_all(&base).unwrap();
    let discussion = uuid::Uuid::new_v4();
    let discussed_session = ThreadId::new();
    let ordinary_session = ThreadId::new();
    for (session, with_discussion) in [(discussed_session, true), (ordinary_session, false)] {
        let mut records = vec![RolloutRecord::SessionMeta {
            session_id: session,
            model: "fixture/model".into(),
            started_at: Utc::now(),
            workspace: None,
        }];
        if with_discussion {
            records.push(RolloutRecord::DiscussionTranscript {
                discussion_id: discussion,
                mode: "sequential".into(),
                participants: vec!["advocate".into(), "skeptic".into()],
                agent_id: None,
                transcript: json!([]),
            });
        }
        let body = records
            .iter()
            .map(|record| serde_json::to_string(record).unwrap() + "\n")
            .collect::<String>();
        std::fs::write(base.join(format!("{session}.jsonl")), body).unwrap();
    }
    let history = common::invoke_ok("reflect_list_discussions", json!({}));
    let ids: Vec<_> = history
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entry| entry["sessionId"].as_str())
        .collect();
    assert_eq!(ids, vec![discussed_session.to_string()], "{history}");
    let filtered = common::invoke_ok(
        "reflect_list_discussions",
        json!({ "discussionId": discussion.to_string() }),
    );
    assert_eq!(filtered.as_array().unwrap().len(), 1, "{filtered}");
    assert_eq!(filtered[0]["sessionId"], discussed_session.to_string());
}
