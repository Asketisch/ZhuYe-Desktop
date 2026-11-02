//! Session 导出为 Markdown (`reflect_export_session_markdown`)。
//!
//! 把 session replay flatten 成 markdown transcript,写到 `~/.zhuye/exports/<id>.md`。
//!
//! 渲染已收编进上游 `reflect_rollout::export`(13 变体渲染 + Usage 段,
//! 与 CLI `/export` 同源单一事实源);桌面端保留:
//! - 回放入口(`replay_for_export`,与 bind/replay/JSON 导出同源);
//! - 写盘语义([`write_export`],tempfile + rename **替换** symlink,
//!   与上游 `write_atomic` 的"写穿 symlink"语义刻意不同)。

use reflect_protocol::ThreadId;
use serde::{Deserialize, Serialize};

use crate::commands::error::{CommandError, CommandResult};
use crate::commands::sessions::replay_for_export;

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownExportResult {
    pub path: String,
    pub bytes: u64,
}

/// 回放 session,flatten 成 Markdown 转写稿,写入
/// `~/.zhuye/exports/<id>.md`,返回绝对路径。
#[tauri::command]
pub async fn reflect_export_session_markdown(id: ThreadId) -> CommandResult<MarkdownExportResult> {
    // 与 bind/replay/JSON 导出同源的回放入口(全树按时间序)。
    // 此前只走三日快路径,旧会话导出为不报错的空稿。
    let records = replay_for_export(&id).await.map_err(CommandError::from)?;

    let mut out = reflect_rollout::export::render_transcript(&id, &records);
    // v1.x:文末「Usage」段(模型级 token 统计 + 压缩节省 + 记忆访问)。
    // 聚合与渲染都走上游;统计缺省(会话尚无落盘记录)→ 空串。
    let stats = reflect_rollout::index::session_stats(&reflect_rollout::path::default_base(), id);
    out.push_str(&reflect_rollout::export::render_usage_section(
        stats.as_ref(),
    ));

    let export_dir = crate::commands::sessions::exports_dir()?;
    let dest = export_dir.join(format!("{id}.md"));
    write_export(&dest, |file| {
        std::io::Write::write_all(file, out.as_bytes())
    })
    .map_err(CommandError::from)?;
    Ok(MarkdownExportResult {
        path: dest.to_string_lossy().into_owned(),
        bytes: out.len() as u64,
    })
}

pub(super) fn write_export(
    path: &std::path::Path,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "export path has no parent",
        )
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    write(temporary.as_file_mut())?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 写盘语义单测;渲染逻辑由上游 `zhuye-rollout::export` 的测试覆盖,
    //! 这里只补一层「上游渲染器 + 桌面写盘」的集成冒烟。

    use super::*;

    #[test]
    fn failed_export_preserves_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.md");
        std::fs::write(&path, "original").unwrap();
        assert!(
            write_export(&path, |file| {
                std::io::Write::write_all(file, b"partial")?;
                Err(std::io::Error::other("simulated write failure"))
            })
            .is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn export_replaces_a_symlink_without_modifying_its_target() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original");
        let path = dir.path().join("session.md");
        std::fs::write(&original, "keep me").unwrap();
        std::os::unix::fs::symlink(&original, &path).unwrap();
        write_export(&path, |file| std::io::Write::write_all(file, b"export")).unwrap();
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "keep me");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "export");
        assert!(
            !std::fs::symlink_metadata(path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    #[test]
    fn upstream_renderers_produce_transcript_and_usage() {
        // 集成冒烟:上游渲染器对桌面回放结果产出的形状(标题 + Usage 段)。
        let id = ThreadId::new();
        let record = reflect_protocol::RolloutRecord::Message {
            turn_id: reflect_protocol::TurnId::new(),
            role: reflect_protocol::MessageRole::User,
            content: serde_json::Value::String("hello".into()),
        };
        let md = reflect_rollout::export::render_transcript(&id, &[record]);
        assert!(md.contains("## Turn 1"));
        assert!(md.contains("**user**: hello"));
        assert_eq!(
            reflect_rollout::export::render_usage_section(None),
            String::new()
        );
    }
}
