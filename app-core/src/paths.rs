//! 数据目录解析 —— 与上游 `zhuye-*` crate 的 home 语义逐字对齐。
//!
//! 核心 crate 自己解析 home（`zhuye-config::default_config_path`、
//! `zhuye-notes::resolve_notes_home`、`zhuye-task::FileTaskStore::with_default_home`
//! 等），优先级一律是 `$ZHUYE_HOME` > `$HOME/.zhuye`。桌面端自有状态文件
//! 必须落进同一个目录，否则 GUI 与 agent 会各自看到一套数据
//! （会话、记忆、权限规则、任务……）。
//!
//! 这里不写任何环境变量：读法与核心一致即可，改环境是启动方的事。

use std::path::{Path, PathBuf};

/// 核心 crate 在用户目录下的数据目录名。
const CORE_DIR: &str = ".zhuye";

/// 用户级数据目录：`$ZHUYE_HOME` > `$HOME/.zhuye`。
///
/// `ZHUYE_HOME` 指向的**就是**数据目录本身（其下直接放 `config.toml`），
/// 与核心语义一致；空值按未设置处理。拿不到任何 home 时返回 `None`，
/// 调用方按各自的降级策略处理（不要 panic）。
pub fn user_data_dir() -> Option<PathBuf> {
    resolve_data_dir(std::env::var_os("ZHUYE_HOME"), std::env::var_os("HOME"))
}

/// [`user_data_dir`] 的纯函数版（不碰进程 env，便于确定性测试）。
fn resolve_data_dir(
    zhuye_home: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    if let Some(dir) = zhuye_home.filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    home.map(PathBuf::from)
        .or_else(dirs::home_dir)
        .map(|dir| dir.join(CORE_DIR))
}

/// 用户级数据目录下的子路径，例如 `user_data_path(&["kms"])` → `~/.zhuye/kms`。
pub fn user_data_path(parts: &[&str]) -> Option<PathBuf> {
    let mut path = user_data_dir()?;
    for part in parts {
        path.push(part);
    }
    Some(path)
}

/// 同 [`user_data_path`]，但取不到 home 时回落到相对路径 `.zhuye/<parts>`。
///
/// 用于「进程仍要能启动，具体命令自己报 IO 错」的场景（与改造前的
/// `dirs::home_dir().unwrap_or_default()` 写法等价，只是不再静默指向根目录）。
pub fn user_data_path_or_relative(parts: &[&str]) -> PathBuf {
    user_data_path(parts).unwrap_or_else(|| {
        let mut path = PathBuf::from(CORE_DIR);
        for part in parts {
            path.push(part);
        }
        path
    })
}

/// 工作区级数据目录：`<workspace>/.zhuye`（与核心的项目级 memory / skills 同源）。
pub fn project_data_dir(workspace: &Path) -> PathBuf {
    workspace.join(CORE_DIR)
}

/// 工作区级数据目录下的子路径。
pub fn project_data_path(workspace: &Path, parts: &[&str]) -> PathBuf {
    let mut path = project_data_dir(workspace);
    for part in parts {
        path.push(part);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zhuye_home_points_at_the_data_dir_itself() {
        // `ZHUYE_HOME` 就是数据目录本身：其下直接放 config.toml,不再拼 `.zhuye`。
        let resolved =
            resolve_data_dir(Some("/srv/instance".into()), Some("/home/u".into())).unwrap();
        assert_eq!(resolved, PathBuf::from("/srv/instance"));
    }

    #[test]
    fn empty_zhuye_home_is_treated_as_unset() {
        let resolved = resolve_data_dir(Some("".into()), Some("/home/u".into())).unwrap();
        assert_eq!(resolved, PathBuf::from("/home/u").join(CORE_DIR));
    }

    #[test]
    fn falls_back_to_home_dot_zhuye() {
        let resolved = resolve_data_dir(None, Some("/home/u".into())).unwrap();
        assert_eq!(resolved, PathBuf::from("/home/u/.zhuye"));
    }

    #[test]
    fn user_data_path_appends_subdirectories() {
        // 只验拼装规则；进程 env 不改，避免与其他并发测试相互污染。
        let mut expected = user_data_dir().unwrap();
        expected.push("sessions-archive");
        assert_eq!(user_data_path(&["sessions-archive"]), Some(expected));
    }

    #[test]
    fn relative_fallback_keeps_the_same_dir_name() {
        // 取不到 home 时的回落必须是相对 `.zhuye`,与 `user_data_path` 同名口径。
        assert_eq!(
            resolve_data_dir(Some("relative/home".into()), None).unwrap(),
            PathBuf::from("relative/home")
        );
    }

    #[test]
    fn project_dir_matches_workspace_naming() {
        assert_eq!(
            project_data_path(Path::new("/ws"), &["agent-memory"]),
            PathBuf::from("/ws/.zhuye/agent-memory")
        );
    }
}
