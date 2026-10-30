//! Autopilot 配置与状态。
//!
//! 当前仅提供配置和历史持久化；尚未接入自动调度或任务执行。

use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Autopilot 系统配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotConfig {
    /// 是否启用 Autopilot。
    pub enabled: bool,
    /// 自动创建任务的 cron 调度。
    pub schedule: String,
    /// 自动创建任务使用的模板 prompt。
    pub task_template: String,
    /// 执行任务所用的 agent。
    pub agent: Option<String>,
    /// Autopilot 任务的最大并发数。
    pub max_concurrent: usize,
}

impl Default for AutopilotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            schedule: String::new(),
            task_template: String::new(),
            agent: None,
            max_concurrent: 1,
        }
    }
}

/// Autopilot 运行历史记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotRun {
    /// 唯一的运行标识符。
    pub id: String,
    /// 运行执行时的时间戳。
    pub executed_at_ms: u64,
    /// 创建的任务 ID。
    pub task_id: Option<String>,
    /// 运行状态。
    pub status: AutopilotRunStatus,
    /// 可选的错误消息。
    pub error: Option<String>,
}

/// Autopilot 运行状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutopilotRunStatus {
    /// 运行成功完成。
    Success,
    /// 运行因错误失败。
    Failed,
    /// 运行仍在进行中。
    InProgress,
    /// 运行已跳过（已达到最大并发数）。
    Skipped,
}

/// 处理配置与历史记录的 Autopilot 管理器。
pub struct AutopilotManager {
    /// 配置文件路径。
    config_path: PathBuf,
    /// 历史记录文件路径。
    history_path: PathBuf,
    history_lock: parking_lot::Mutex<()>,
}

impl Default for AutopilotManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AutopilotManager {
    /// 使用默认路径创建 AutopilotManager（`~/.zhuye/autopilot/`）。
    pub fn new() -> Self {
        let root = crate::paths::user_data_path_or_relative(&["autopilot"]);
        Self::new_with_root(root)
    }

    /// 使用指定根目录创建 AutopilotManager（仅用于测试）。
    ///
    /// `root` 不需要预先存在;`save_*` 会 `create_dir_all`。
    pub fn new_with_root(root: PathBuf) -> Self {
        Self {
            config_path: root.join("config.json"),
            history_path: root.join("history.json"),
            history_lock: parking_lot::Mutex::new(()),
        }
    }

    /// 加载配置；只有文件不存在时使用默认配置。
    pub fn load_config(&self) -> io::Result<AutopilotConfig> {
        read_json_or_default(&self.config_path)
    }

    /// 将配置保存到磁盘。
    pub fn save_config(&self, config: &AutopilotConfig) -> Result<(), std::io::Error> {
        let content = serde_json::to_string_pretty(config)?;
        write_json_atomic(&self.config_path, content.as_bytes())
    }

    /// 加载运行历史。
    pub fn load_history(&self) -> io::Result<Vec<AutopilotRun>> {
        let _guard = self.history_lock.lock();
        read_json_or_default(&self.history_path)
    }

    /// 保存运行历史。
    pub fn save_history(&self, history: &[AutopilotRun]) -> Result<(), std::io::Error> {
        let _guard = self.history_lock.lock();
        self.write_history(history)
    }

    /// 向历史记录添加一次新运行。
    pub fn add_run(&self, run: AutopilotRun) -> Result<(), std::io::Error> {
        let _guard = self.history_lock.lock();
        let mut history: Vec<AutopilotRun> = read_json_or_default(&self.history_path)?;
        history.insert(0, run);
        // 仅保留最近 100 次运行。
        if history.len() > 100 {
            history.truncate(100);
        }
        self.write_history(&history)
    }

    fn write_history(&self, history: &[AutopilotRun]) -> io::Result<()> {
        let content = serde_json::to_vec_pretty(history)?;
        write_json_atomic(&self.history_path, &content)
    }

    /// 根据当前配置检查是否应执行运行。
    pub fn should_run(&self) -> io::Result<bool> {
        let config = self.load_config()?;
        Ok(config.enabled && !config.schedule.is_empty())
    }
}

fn write_json_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("autopilot file has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let target = match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path.canonicalize()?,
        Ok(_) => path.to_path_buf(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(error),
    };
    let target_parent = target
        .parent()
        .ok_or_else(|| io::Error::other("autopilot target has no parent"))?;
    let mut temp = tempfile::NamedTempFile::new_in(target_parent)?;
    match std::fs::metadata(&target) {
        Ok(metadata) => temp.as_file().set_permissions(metadata.permissions())?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    temp.write_all(content)?;
    temp.as_file().sync_all()?;
    temp.persist(&target).map_err(|error| error.error)?;
    Ok(())
}

fn read_json_or_default<T: serde::de::DeserializeOwned + Default>(path: &Path) -> io::Result<T> {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: {error}", path.display()),
            )
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试用独立 tempdir,避免污染真实 `~/.zhuye/autopilot/`(生产态)。
    fn fresh_manager() -> AutopilotManager {
        let dir = tempfile::tempdir().expect("tempdir");
        // 泄漏 tempdir 使文件在测试期间存活（test 进程退出时清理）。
        let path = dir.keep();
        AutopilotManager::new_with_root(path)
    }

    #[test]
    fn default_config_is_disabled() {
        let config = AutopilotConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.max_concurrent, 1);
    }

    #[test]
    fn load_config_creates_default() {
        let manager = fresh_manager();
        let config = manager.load_config().unwrap();
        assert!(!config.enabled);
    }

    #[test]
    fn save_and_load_config() {
        let manager = fresh_manager();
        let config = AutopilotConfig {
            enabled: true,
            schedule: "0 * * * *".to_string(),
            ..AutopilotConfig::default()
        };
        manager.save_config(&config).unwrap();

        let loaded = manager.load_config().unwrap();
        assert!(loaded.enabled);
        assert_eq!(loaded.schedule, "0 * * * *");
    }

    #[test]
    fn history_starts_empty() {
        let manager = fresh_manager();
        let history = manager.load_history().unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn saves_create_missing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let manager = AutopilotManager::new_with_root(dir.path().join("missing"));
        manager.save_config(&AutopilotConfig::default()).unwrap();
        manager.save_history(&[]).unwrap();
        assert!(!manager.load_config().unwrap().enabled);
        assert!(manager.load_history().unwrap().is_empty());
    }

    #[test]
    fn concurrent_runs_are_all_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            std::sync::Arc::new(AutopilotManager::new_with_root(dir.path().to_path_buf()));
        let workers: Vec<_> = (0..40)
            .map(|index| {
                let manager = manager.clone();
                std::thread::spawn(move || {
                    manager
                        .add_run(AutopilotRun {
                            id: index.to_string(),
                            executed_at_ms: index,
                            task_id: None,
                            status: AutopilotRunStatus::Success,
                            error: None,
                        })
                        .unwrap()
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let history = manager.load_history().unwrap();
        let ids: std::collections::HashSet<_> = history.iter().map(|run| &run.id).collect();
        assert_eq!(history.len(), 40);
        assert_eq!(ids.len(), 40);
    }

    #[cfg(unix)]
    #[test]
    fn save_preserves_symlink_and_permissions() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = tempfile::tempdir().unwrap();
        let manager = AutopilotManager::new_with_root(dir.path().to_path_buf());
        let target = dir.path().join("actual.json");
        let link = dir.path().join("config.json");
        std::fs::write(&target, "{}").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink("actual.json", &link).unwrap();
        manager.save_config(&AutopilotConfig::default()).unwrap();
        assert!(
            std::fs::symlink_metadata(link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            std::fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert!(!manager.load_config().unwrap().enabled);
    }

    #[test]
    fn malformed_files_are_reported_and_history_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let manager = AutopilotManager::new_with_root(dir.path().to_path_buf());
        std::fs::write(dir.path().join("config.json"), "invalid config").unwrap();
        let history = dir.path().join("history.json");
        std::fs::write(&history, "invalid history").unwrap();
        assert_eq!(
            manager.load_config().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            manager.should_run().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            manager.load_history().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        let run = AutopilotRun {
            id: "run".into(),
            executed_at_ms: 0,
            task_id: None,
            status: AutopilotRunStatus::Success,
            error: None,
        };
        assert!(manager.add_run(run).is_err());
        assert_eq!(std::fs::read_to_string(history).unwrap(), "invalid history");
    }
}
