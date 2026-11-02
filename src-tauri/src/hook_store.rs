//! 已注册 hook 的启停偏好；运行状态以当前 HookEngine 为准。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use reflect_hooks::HookEngine;

use crate::commands::HookInfo;

pub(crate) struct HookStore {
    path: Option<PathBuf>,
    lock: Mutex<()>,
}

impl Default for HookStore {
    fn default() -> Self {
        Self {
            path: reflect_config::paths::data_path(&["hook_state.json"]),
            lock: Mutex::new(()),
        }
    }
}

impl HookStore {
    pub(crate) fn list(&self, engine: &HookEngine) -> Vec<HookInfo> {
        let mut seen = std::collections::HashSet::new();
        engine
            .hook_summaries()
            .into_iter()
            .filter(|(name, _)| seen.insert(name.clone()))
            .map(|(name, description)| {
                let kind = if matches!(
                    name.as_str(),
                    "search_budget"
                        | "test_runner"
                        | "plan_completion"
                        | "verification"
                        | "langfuse_tracker"
                        | "read_before_edit"
                        | "plan_mode_gate"
                ) {
                    "builtin"
                } else {
                    "custom"
                };
                HookInfo {
                    enabled: !engine.is_disabled(&name),
                    name,
                    kind: kind.into(),
                    config_summary: description,
                }
            })
            .collect()
    }

    /// 先持久化，再修改当前引擎；写入失败时运行状态保持不变。
    pub(crate) fn toggle(
        &self,
        engine: &HookEngine,
        name: &str,
        enabled: bool,
    ) -> anyhow::Result<()> {
        let _guard = self.lock.lock();
        if !engine
            .hook_names()
            .iter()
            .any(|registered| registered == name)
        {
            anyhow::bail!("hook is not registered: {name}");
        }
        let path = self
            .path
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no home dir"))?;
        let mut state = read_state(path)?;
        state.insert(name.to_string(), enabled);
        write_state(path, &state)?;
        if enabled {
            engine.enable(name);
        } else {
            engine.disable(name);
        }
        Ok(())
    }

    /// 只恢复显式禁用项，不覆盖插件管理器的禁用状态。
    pub(crate) fn apply_disabled(&self, engine: &HookEngine) -> anyhow::Result<()> {
        let _guard = self.lock.lock();
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        for (name, enabled) in read_state(path)? {
            if !enabled && name != crate::state::plugin_hooks::FORWARDER_NAME {
                engine.disable(&name);
            }
        }
        Ok(())
    }
}

fn read_state(path: &Path) -> anyhow::Result<HashMap<String, bool>> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(error.into()),
    }
}

fn write_state(path: &Path, state: &HashMap<String, bool>) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("hook state has no parent directory"))?;
    std::fs::create_dir_all(parent)?;
    crate::persistence::write_atomic(path, serde_json::to_string_pretty(state)?.as_bytes())
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_hooks::builtins::TestRunnerHook;

    #[test]
    fn toggle_updates_real_engine_and_restores_after_rebuild() {
        let dir = tempfile::tempdir().unwrap();
        let store = HookStore {
            path: Some(dir.path().join("state.json")),
            lock: Mutex::new(()),
        };
        let engine = HookEngine::new();
        engine.register(TestRunnerHook::default());
        store.toggle(&engine, "test_runner", false).unwrap();
        assert!(engine.is_disabled("test_runner"));
        assert!(!store.list(&engine)[0].enabled);
        let next = HookEngine::new();
        next.register(TestRunnerHook::default());
        store.apply_disabled(&next).unwrap();
        assert!(next.is_disabled("test_runner"));
        store.toggle(&next, "test_runner", true).unwrap();
        assert!(!next.is_disabled("test_runner"));
    }

    #[test]
    fn corrupt_preferences_and_unknown_hooks_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        std::fs::write(&path, "invalid json").unwrap();
        let store = HookStore {
            path: Some(path.clone()),
            lock: Mutex::new(()),
        };
        let engine = HookEngine::new();
        engine.register(TestRunnerHook::default());
        assert!(store.toggle(&engine, "test_runner", false).is_err());
        assert!(store.toggle(&engine, "unknown", false).is_err());
        assert!(!engine.is_disabled("test_runner"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "invalid json");
    }

    #[tokio::test]
    async fn toggles_change_dispatched_decisions() {
        use reflect_hooks::{HookDecision, HookEvent};
        use reflect_protocol::{ContentBlock, ToolOutput};
        let dir = tempfile::tempdir().unwrap();
        let store = HookStore {
            path: Some(dir.path().join("state.json")),
            lock: Mutex::new(()),
        };
        let engine = HookEngine::new();
        engine.register(TestRunnerHook::default());
        let event = HookEvent::PostToolUse {
            tool: "bash".into(),
            result: ToolOutput {
                content: vec![ContentBlock::text("test result: FAILED")],
                is_error: false,
                metadata: serde_json::json!({}),
                elapsed_ms: 0,
            },
            elapsed_ms: 0,
        };
        assert!(matches!(
            engine.dispatch(&event).await,
            HookDecision::InjectMessage(_)
        ));
        store.toggle(&engine, "test_runner", false).unwrap();
        assert!(matches!(engine.dispatch(&event).await, HookDecision::Allow));
        store.toggle(&engine, "test_runner", true).unwrap();
        assert!(matches!(
            engine.dispatch(&event).await,
            HookDecision::InjectMessage(_)
        ));
    }

    #[test]
    fn concurrent_toggles_preserve_both_preferences() {
        use reflect_hooks::builtins::SearchBudgetHook;
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let store = Arc::new(HookStore {
            path: Some(path.clone()),
            lock: Mutex::new(()),
        });
        let engine = Arc::new(HookEngine::new());
        engine.register(TestRunnerHook::default());
        engine.register(SearchBudgetHook::new(20, Default::default()));
        std::thread::scope(|scope| {
            for name in ["test_runner", "search_budget"] {
                let store = store.clone();
                let engine = engine.clone();
                scope.spawn(move || store.toggle(&engine, name, false).unwrap());
            }
        });
        let state = read_state(&path).unwrap();
        assert_eq!(state.get("test_runner"), Some(&false));
        assert_eq!(state.get("search_budget"), Some(&false));
        assert!(engine.is_disabled("test_runner"));
        assert!(engine.is_disabled("search_budget"));
    }
}
