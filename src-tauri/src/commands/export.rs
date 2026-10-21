//! Session 导出为 Markdown (`reflect_export_session_markdown`)。
//!
//! 把 session replay flatten 成 markdown transcript,写到 `~/.reflect/exports/<id>.md`。
//!
//! 渲染拆成两个纯函数(便于单测,渲染逻辑无 IO):
//! - [`render_transcript`] —— 逐条 rollout 记录的转写稿;
//! - [`render_usage_section`] —— 文末「Usage」段(模型级 token 统计)。

use reflect_protocol::ThreadId;
use serde::{Deserialize, Serialize};

use crate::commands::error::{CommandError, CommandResult};
use crate::commands::sessions::replay_for_export;

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownExportResult {
    pub path: String,
    pub bytes: u64,
}

/// 把 rollout 记录渲染成 markdown 转写稿(纯函数,无 IO)。
fn render_transcript(id: &ThreadId, records: &[reflect_protocol::RolloutRecord]) -> String {
    use reflect_protocol::RolloutRecord;

    let mut out = String::new();
    out.push_str(&format!("# Reflect session `{id}`\n\n"));
    let mut session_meta_emitted = false;
    let mut count: usize = 0;
    for r in records {
        match r {
            RolloutRecord::SessionMeta {
                session_id: _,
                model,
                started_at: _,
                workspace: _,
            } => {
                if !session_meta_emitted {
                    out.push_str(&format!("**model**: `{model}`\n\n"));
                    session_meta_emitted = true;
                }
            }
            RolloutRecord::Message {
                turn_id: _,
                role,
                content,
            } => {
                count += 1;
                // `content` 是 serde_json::Value;字符串直接当作文本。
                let text = match content {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                let label = match role {
                    reflect_protocol::MessageRole::User => "**user**",
                    reflect_protocol::MessageRole::Assistant => "**agent**",
                    reflect_protocol::MessageRole::System => "**system**",
                    reflect_protocol::MessageRole::Tool => "**tool**",
                };
                out.push_str(&format!("\n## Turn {count}\n\n{label}: "));
                out.push_str(&text);
                out.push_str("\n\n");
            }
            RolloutRecord::Compaction {
                strategy,
                removed_count,
                summary,
                before_tokens,
                after_tokens,
                ..
            } => {
                // v1.x:before/after 是压缩前后的上下文 token 估算(旧 JSONL 缺省为 0)。
                let saved = before_tokens.saturating_sub(*after_tokens);
                out.push_str(&format!(
                    "\n---\n*compaction* (`{strategy}`, removed {removed_count} messages"
                ));
                if *before_tokens > 0 {
                    out.push_str(&format!(
                        ", {before_tokens} → {after_tokens} tokens (saved {saved})"
                    ));
                }
                out.push_str(")\n\n");
                if !summary.is_empty() {
                    out.push_str("> ");
                    out.push_str(summary);
                    out.push_str("\n\n");
                }
            }
            RolloutRecord::Fork {
                parent_session_id,
                branch_name,
            } => {
                out.push_str(&format!(
                    "\n*forked from `{parent_session_id}` as `{branch_name}`*\n\n"
                ));
            }
            RolloutRecord::Checkpoint { sha, label, .. } => {
                let tag = label.clone().unwrap_or_else(|| "checkpoint".to_string());
                out.push_str(&format!("\n*checkpoint `{tag}` @ {sha}`*\n\n"));
            }
            RolloutRecord::Rewind {
                target_sha,
                from_sha,
                ..
            } => {
                out.push_str(&format!("\n*rewind* (`{from_sha}` → `{target_sha}`)\n\n"));
            }
            RolloutRecord::DiscussionTranscript {
                mode,
                participants,
                transcript,
                ..
            } => {
                out.push_str(&format!(
                    "\n## Discussion ({mode})\n\nParticipants: {}\n\n",
                    participants.join(", ")
                ));
                let pretty = match transcript {
                    serde_json::Value::String(s) => s.clone(),
                    other => serde_json::to_string_pretty(other).unwrap_or_default(),
                };
                out.push_str(&pretty);
                out.push_str("\n\n");
            }
            // v1.x:记忆访问审计(检索注入 / 固化写入)。此前只有 tracing 日志,
            // 落盘后可在导出稿回看「这个会话注入了哪些记忆 / 固化了什么」。
            RolloutRecord::MemoryAccess {
                op,
                scope,
                agent_type,
                chars,
                entries,
                ..
            } => {
                let (label, detail) = match op {
                    reflect_protocol::MemoryOp::Read => (
                        "memory read",
                        format!("scope `{scope}`, agent `{agent_type}`, {chars} chars"),
                    ),
                    reflect_protocol::MemoryOp::Write => (
                        "memory write",
                        format!(
                            "scope `{scope}`, agent `{agent_type}`, {entries} entries, {chars} chars"
                        ),
                    ),
                };
                out.push_str(&format!("\n*{label}* ({detail})\n\n"));
            }
            // v1.x:per-turn token 用量快照(累计自 EventMsg::TokenCount)。
            // Markdown 导出不逐条渲染 —— 改由文末「Usage」段统一聚合
            // (含模型级拆分),此处显式忽略以保证 match 穷尽。
            RolloutRecord::TokenCount { .. } => {}
            // Plan 工作流与权限模式变更记录:Markdown 转写稿不渲染,
            // 显式忽略以保证 match 穷尽。
            RolloutRecord::PlanRequest { .. }
            | RolloutRecord::PlanReady { .. }
            | RolloutRecord::PlanRejected { .. }
            | RolloutRecord::PermissionModeChanged { .. } => {}
        }
    }
    out
}

/// 渲染文末「Usage」段(纯函数)。
///
/// 复用 `app_core::stats` 的规范聚合(模型级拆分 + 压缩节省 + 记忆访问),
/// 不在导出层复刻 token 聚合逻辑。统计缺省(会话尚无落盘记录)→ 空串。
fn render_usage_section(stats: Option<&reflect_app_core::stats::SessionStats>) -> String {
    let Some(stats) = stats else {
        return String::new();
    };
    let mut out = String::from("\n## Usage\n\n");
    out.push_str(&format!("- model: `{}`\n", stats.model));
    out.push_str(&format!("- messages: {}\n", stats.message_count));
    out.push_str(&format!("- tool calls: {}\n", stats.tool_calls));
    out.push_str(&format!(
        "- tokens: {} in / {} out / {} total\n",
        stats.input_tokens, stats.output_tokens, stats.total_tokens
    ));
    if stats.cached_tokens > 0 {
        out.push_str(&format!("- cached: {}\n", stats.cached_tokens));
    }
    if let Some(cost) = stats.cost_usd {
        out.push_str(&format!("- cost: ${cost:.4}\n"));
    }
    if stats.compactions > 0 {
        out.push_str(&format!(
            "- compactions: {} (saved {} tokens)\n",
            stats.compactions, stats.compaction_tokens_saved
        ));
    }
    if stats.memory_reads > 0 || stats.memory_writes > 0 {
        out.push_str(&format!(
            "- memory: {} reads / {} writes\n",
            stats.memory_reads, stats.memory_writes
        ));
    }
    if !stats.per_model.is_empty() {
        out.push_str("\n### Per model\n\n");
        out.push_str("| model | provider | calls | input | output | total | cost |\n");
        out.push_str("| --- | --- | ---: | ---: | ---: | ---: | ---: |\n");
        for m in &stats.per_model {
            let cost = m
                .cost_usd
                .map(|c| format!("${c:.4}"))
                .unwrap_or_else(|| "-".to_string());
            out.push_str(&format!(
                "| `{}` | {} | {} | {} | {} | {} | {} |\n",
                m.model,
                m.provider.as_deref().unwrap_or("-"),
                m.calls,
                m.input_tokens,
                m.output_tokens,
                m.total_tokens,
                cost
            ));
        }
    }
    out.push('\n');
    out
}

/// 回放 session,flatten 成 Markdown 转写稿,写入
/// `~/.reflect/exports/<id>.md`,返回绝对路径。
#[tauri::command]
pub async fn reflect_export_session_markdown(id: ThreadId) -> CommandResult<MarkdownExportResult> {
    let home = dirs::home_dir().ok_or_else(|| CommandError {
        msg: "no HOME dir".into(),
    })?;
    // 与 bind/replay/JSON 导出同源的回放入口(全树按时间序)。
    // 此前只走三日快路径,旧会话导出为不报错的空稿。
    let records = replay_for_export(&id).await.map_err(CommandError::from)?;

    let mut out = render_transcript(&id, &records);
    // v1.x:文末「Usage」段(模型级 token 统计 + 压缩节省 + 记忆访问)。
    out.push_str(&render_usage_section(
        reflect_app_core::stats::session_stats(&id).as_ref(),
    ));

    let export_dir = home.join(".reflect/exports");
    std::fs::create_dir_all(&export_dir).map_err(CommandError::from)?;
    let dest = export_dir.join(format!("{id}.md"));
    std::fs::write(&dest, &out).map_err(CommandError::from)?;
    Ok(MarkdownExportResult {
        path: dest.to_string_lossy().into_owned(),
        bytes: out.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    //! 渲染层单测(纯函数,无 IO)。

    use super::*;
    use reflect_protocol::{MemoryOp, RolloutRecord, TurnId};

    fn turn_id() -> TurnId {
        TurnId::parse_str("33333333-4444-5555-6666-777777777777").unwrap()
    }

    fn message(role: reflect_protocol::MessageRole, text: &str) -> RolloutRecord {
        RolloutRecord::Message {
            turn_id: turn_id(),
            role,
            content: serde_json::Value::String(text.to_string()),
        }
    }

    #[test]
    fn transcript_renders_messages_and_model() {
        let id = ThreadId::parse_str("11111111-2222-3333-4444-555555555555").unwrap();
        let records = vec![
            RolloutRecord::SessionMeta {
                session_id: id,
                model: "openai/gpt-4o".into(),
                started_at: chrono::Utc::now(),
                workspace: None,
            },
            message(reflect_protocol::MessageRole::User, "hello"),
            message(reflect_protocol::MessageRole::Assistant, "hi"),
        ];
        let md = render_transcript(&id, &records);
        assert!(md.contains("**model**: `openai/gpt-4o`"));
        assert!(md.contains("## Turn 1"));
        assert!(md.contains("## Turn 2"));
        assert!(md.contains("**user**: hello"));
        assert!(md.contains("**agent**: hi"));
    }

    #[test]
    fn transcript_renders_memory_access_audit() {
        // v1.x:记忆访问审计(读 / 写两种 op)。
        let id = ThreadId::new();
        let records = vec![
            RolloutRecord::MemoryAccess {
                turn_id: turn_id(),
                op: MemoryOp::Read,
                scope: "project,user".into(),
                agent_type: "coder".into(),
                chars: 1234,
                entries: 0,
                at: chrono::Utc::now(),
            },
            RolloutRecord::MemoryAccess {
                turn_id: turn_id(),
                op: MemoryOp::Write,
                scope: "project".into(),
                agent_type: "coder".into(),
                chars: 56,
                entries: 3,
                at: chrono::Utc::now(),
            },
        ];
        let md = render_transcript(&id, &records);
        assert!(md.contains("*memory read* (scope `project,user`, agent `coder`, 1234 chars)"));
        assert!(
            md.contains("*memory write* (scope `project`, agent `coder`, 3 entries, 56 chars)")
        );
    }

    #[test]
    fn transcript_renders_compaction_token_saving() {
        let id = ThreadId::new();
        let records = vec![RolloutRecord::Compaction {
            turn_id: turn_id(),
            strategy: "microcompact".into(),
            removed_count: 12,
            summary: "<summary/>".into(),
            before_tokens: 9000,
            after_tokens: 2000,
        }];
        let md = render_transcript(&id, &records);
        assert!(md.contains("9000 → 2000 tokens (saved 7000)"));
    }

    #[test]
    fn transcript_omits_token_delta_for_legacy_records() {
        // 旧 JSONL 的 compaction 无 before/after 字段 → 反序列化为 0,
        // 此时不渲染 token 段(避免误导性的 "0 → 0")。
        let id = ThreadId::new();
        let records = vec![RolloutRecord::Compaction {
            turn_id: turn_id(),
            strategy: "microcompact".into(),
            removed_count: 3,
            summary: String::new(),
            before_tokens: 0,
            after_tokens: 0,
        }];
        let md = render_transcript(&id, &records);
        assert!(md.contains("removed 3 messages"));
        assert!(!md.contains("tokens (saved"));
    }

    #[test]
    fn usage_section_is_empty_without_stats() {
        assert_eq!(render_usage_section(None), "");
    }

    #[test]
    fn usage_section_renders_per_model_table() {
        // v1.x:文末 Usage 段 —— 总量 + 模型级拆分 + 压缩节省 + 记忆访问。
        let stats = reflect_app_core::stats::SessionStats {
            session_id: "11111111-2222-3333-4444-555555555555".to_string(),
            model: "openai/gpt-4o".into(),
            started_at: chrono::Utc::now(),
            message_count: 12,
            tool_calls: 3,
            compactions: 1,
            compaction_before_tokens: 9000,
            compaction_after_tokens: 2000,
            compaction_tokens_saved: 7000,
            memory_reads: 2,
            memory_writes: 1,
            input_tokens: 1000,
            output_tokens: 200,
            cached_tokens: 250,
            cache_write_tokens: 0,
            total_tokens: 1200,
            cost_usd: Some(0.0234),
            cache_hit_rate: Some(0.25),
            per_model: vec![reflect_app_core::stats::ModelUsage {
                model: "openai/gpt-4o".into(),
                provider: Some("openai".into()),
                calls: 4,
                input_tokens: 1000,
                output_tokens: 200,
                cached_tokens: 250,
                cache_write_tokens: 0,
                total_tokens: 1200,
                cost_usd: Some(0.0234),
            }],
        };
        let md = render_usage_section(Some(&stats));
        assert!(md.contains("## Usage"));
        assert!(md.contains("- model: `openai/gpt-4o`"));
        assert!(md.contains("- tokens: 1000 in / 200 out / 1200 total"));
        assert!(md.contains("- cost: $0.0234"));
        assert!(md.contains("- compactions: 1 (saved 7000 tokens)"));
        assert!(md.contains("- memory: 2 reads / 1 writes"));
        assert!(md.contains("### Per model"));
        assert!(md.contains("| `openai/gpt-4o` | openai | 4 | 1000 | 200 | 1200 | $0.0234 |"));
    }
}
