//! MCP 工具注册所有权跟踪。
//!
//! 原与 MCP bootstrap 同栖 `mcp.rs`,为守 500 行文件预算拆出。仅记录每个
//! 服务实际注册的工具,避免卸载 / 清单刷新时误删同名或已替换的工具。

use std::collections::HashSet;
use std::sync::Arc;

use zhuye_tools::{ToolRegistry, ToolSource};

/// 仅记录每个服务实际注册的工具,避免卸载时误删同名或已替换的工具。
#[derive(Default)]
pub(crate) struct McpTools(
    parking_lot::Mutex<std::collections::HashMap<String, Vec<Arc<dyn zhuye_tools::Tool>>>>,
);

impl McpTools {
    pub(crate) fn register(
        &self,
        tools: &ToolRegistry,
        server: &str,
        tool: Arc<dyn zhuye_tools::Tool>,
    ) -> bool {
        let name = tool.name().to_string();
        // `with_floor` 变体才会给外部工具套权限 floor；它存入注册表的是
        // 包装后的句柄，因此 ownership 必须记注册表里那份，不能记自己这份。
        if !tools.register_if_absent_with_floor(ToolSource::Runtime, tool.clone()) {
            return false;
        }
        let stored = tools.get(&name).unwrap_or(tool);
        self.0
            .lock()
            .entry(server.to_string())
            .or_default()
            .push(stored);
        true
    }

    pub(crate) fn remove(&self, tools: &ToolRegistry, server: &str) -> Vec<String> {
        let owned = self.0.lock().remove(server).unwrap_or_default();
        owned
            .into_iter()
            .filter_map(|tool| {
                let name = tool.name().to_string();
                // 只删仍然是自己那份的同名工具，不动后来顶替上来的实现。
                tools
                    .get(&name)
                    .is_some_and(|current| Arc::ptr_eq(&current, &tool))
                    .then(|| tools.unregister(&name).then_some(name))
                    .flatten()
            })
            .collect()
    }

    /// 工具清单刷新(`ToolsChanged`)时的增量移除:仅反注册该 server 名下、
    /// 且已从新清单(`keep`)消失的工具;仍在清单里的保留所有权。返回被
    /// 移除的全名。与 `remove` 同款 ptr_eq 守卫 —— 不动后来顶替上来的实现。
    pub(crate) fn remove_except(
        &self,
        tools: &ToolRegistry,
        server: &str,
        keep: &HashSet<String>,
    ) -> Vec<String> {
        let (gone, retained): (Vec<_>, Vec<_>) = self
            .0
            .lock()
            .remove(server)
            .unwrap_or_default()
            .into_iter()
            .partition(|tool| !keep.contains(&tool.name().to_string()));
        if !retained.is_empty() {
            self.0.lock().insert(server.to_string(), retained);
        }
        gone.into_iter()
            .filter_map(|tool| {
                let name = tool.name().to_string();
                tools
                    .get(&name)
                    .is_some_and(|current| Arc::ptr_eq(&current, &tool))
                    .then(|| tools.unregister(&name).then_some(name))
                    .flatten()
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestTool(&'static str);
    #[async_trait::async_trait]
    impl zhuye_tools::Tool for TestTool {
        fn name(&self) -> &str {
            self.0
        }
        fn description(&self) -> &str {
            "test"
        }
        fn parameters_schema(&self) -> serde_json::Value {
            serde_json::json!({"type": "object"})
        }
        async fn execute(
            &self,
            _: zhuye_tools::ToolContext,
            _: serde_json::Value,
        ) -> Result<zhuye_protocol::ToolOutput, zhuye_tools::ToolError> {
            unreachable!()
        }
    }

    #[test]
    fn stopping_server_preserves_colliding_and_replaced_tools() {
        let tools = ToolRegistry::new();
        let owned = McpTools::default();
        tools.register(Arc::new(TestTool("collision")));
        assert!(!owned.register(&tools, "server", Arc::new(TestTool("collision"))));
        assert!(owned.register(&tools, "server", Arc::new(TestTool("replaced"))));
        assert!(owned.register(&tools, "server", Arc::new(TestTool("original"))));
        tools.register(Arc::new(TestTool("replaced")));
        assert_eq!(owned.remove(&tools, "server"), vec!["original"]);
        assert!(tools.get("collision").is_some());
        assert!(tools.get("replaced").is_some());
        assert!(tools.get("original").is_none());
    }

    #[test]
    fn tools_changed_refresh_only_unregisters_gone_tools() {
        // ToolsChanged 增量同步:新清单里消失的才反注册,保留项所有权
        // 不丢(后续 stop_server 仍能按所有权清场)。
        let tools = ToolRegistry::new();
        let owned = McpTools::default();
        assert!(owned.register(&tools, "server", Arc::new(TestTool("mcp__s__keep"))));
        assert!(owned.register(&tools, "server", Arc::new(TestTool("mcp__s__gone"))));
        let keep: HashSet<String> = ["mcp__s__keep".to_string()].into();
        assert_eq!(
            owned.remove_except(&tools, "server", &keep),
            vec!["mcp__s__gone"]
        );
        assert!(tools.get("mcp__s__keep").is_some());
        assert!(tools.get("mcp__s__gone").is_none());
        assert_eq!(owned.remove(&tools, "server"), vec!["mcp__s__keep"]);
        assert!(tools.get("mcp__s__keep").is_none());
    }
}
