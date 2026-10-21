//! 权限层装配 —— 与 CLI(`reflect-exec` 的 `apply_permission_layers`)同构。
//!
//! ## 为什么桌面端必须装
//!
//! 核心的权限规则(`reflect-permissions`)决定工具调用是否被拒。CLI 装了
//! 三层链式 store,**更具体的作用域在前**(first-match-wins):
//!
//! 1. `config.toml` 的 `[permissions]` 段(会话级,只读)
//! 2. `<workspace>/.reflect/permissions.toml`(项目级,随工作区签入)
//! 3. `~/.reflect/permissions.toml`(用户级,可写 —— `/permissions allow` 落盘处)
//!
//! 桌面端此前**没有**挂解析器(`AgentConfig::with_permission_resolver` 未调用,
//! `yolo_classifier` 也为 None):同一份配置在 CLI 里生效的 `deny` 规则,到了
//! 桌面端被静默忽略 —— 两个前端的**安全行为分叉**。本模块把桌面端对齐到
//! CLI 口径,并让规则在 GUI 里可见(见 `commands/permissions.rs`)。
//!
//! ## 为什么用 `futures::executor::block_on`
//!
//! 整条装配链里唯一需要 await 的是「把 config 规则灌进内存 store」
//! (`PermissionStore::add` 是 async_trait 方法)。该 future 只做一次
//! `Mutex::push`,首次 poll 即就绪、不会 park,因此用**独立的**执行器同步
//! 等待是安全的:不依赖外层 tokio 上下文(桌面端线程构造既有在 Tauri
//! `setup()` 同步段调用的,也有在 async 命令里调用的),也不会与外层
//! runtime 抢线程。
//!
//! ## 与 CLI 的差异
//!
//! CLI 额外记录 project store 的规则条数(一次 `list().await`)。桌面端
//! 省掉这次读盘 —— 规则条数由 `commands/permissions.rs` 的查询命令按需
//! 读取,不在每次线程构造的热路径上多打一次盘。

use std::path::Path;
use std::sync::Arc;

use reflect_core::AgentConfig;
use reflect_permissions::{
    ChainedPermissionStore, FilePermissionStore, HeuristicYoloClassifier, InMemoryPermissionStore,
    PermissionResolver, PermissionStore, StorePermissionResolver,
};
use tracing::warn;

/// 装配权限层 + YOLO 分类器,返回挂载好的 `AgentConfig`。
///
/// - `initial_cfg`:线程构造时的 config 快照(`[permissions]` 段来源)。
/// - `workspace`:项目级权限文件所在的工作区根目录。
pub(crate) fn apply_permission_layers(
    mut cfg: AgentConfig,
    initial_cfg: &reflect_config::ReflectConfig,
    workspace: &Path,
) -> AgentConfig {
    let Ok(user_store) = FilePermissionStore::with_default_home() else {
        // 用户级 store 不可用(无 HOME / 权限异常)→ 仍装 YOLO 分类器
        // (「全放行」建议能力可用),规则层留空 = 走 PermissionMode 默认
        // 行为,而不是把用户的工具全部拒掉。
        warn!("[reflect-gui] 用户级权限文件不可用,仅启用 YOLO 分类器");
        cfg.yolo_classifier = Some(Arc::new(HeuristicYoloClassifier));
        return cfg;
    };
    let user_store: Arc<dyn PermissionStore> = Arc::new(user_store);

    // config.toml `[permissions]` → 内存 store(只读层,排在最前 = 优先匹配)。
    let cfg_store: Arc<dyn PermissionStore> = Arc::new(InMemoryPermissionStore::new());
    if let Some(sec) = &initial_cfg.permissions {
        let rules = sec.expanded_rules();
        futures::executor::block_on(async {
            for rule in &rules {
                if let Err(e) = cfg_store.add(rule.clone()).await {
                    warn!(error = %e, "config.toml [permissions] 规则落库失败,跳过该条");
                }
            }
        });
        tracing::info!(
            rules = rules.len(),
            "[reflect-gui] 已加载 config.toml [permissions] 规则"
        );
    }

    // 项目级权限 —— `<workspace>/.reflect/permissions.toml`。
    let project_path = workspace.join(".reflect").join("permissions.toml");
    let project_store: Arc<dyn PermissionStore> =
        Arc::new(FilePermissionStore::with_path(project_path));

    let chained: Arc<dyn PermissionStore> = Arc::new(ChainedPermissionStore::new(vec![
        cfg_store,
        project_store,
        user_store,
    ]));
    let resolver: Arc<dyn PermissionResolver> = Arc::new(StorePermissionResolver::new(chained));
    cfg = cfg.with_permission_resolver(resolver);
    cfg.yolo_classifier = Some(Arc::new(HeuristicYoloClassifier));
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 装配后 `AgentConfig` 必须带上权限解析器与 YOLO 分类器 ——
    /// 否则桌面端会静默忽略 CLI 侧同配置的 deny 规则。
    #[test]
    fn apply_permission_layers_mounts_resolver_and_classifier() {
        let cfg = AgentConfig::new("stub/test", Path::new("/tmp"));
        let initial = reflect_config::ReflectConfig::default();
        let out = apply_permission_layers(cfg, &initial, Path::new("/tmp"));
        assert!(out.permission_resolver.is_some(), "必须挂上权限解析器");
        assert!(out.yolo_classifier.is_some(), "必须挂上 YOLO 分类器");
    }

    /// 工作区不存在时也不应 panic(项目级 store 只是指向一个不存在的路径)。
    #[test]
    fn apply_permission_layers_tolerates_missing_workspace() {
        let cfg = AgentConfig::new("stub/test", Path::new("/tmp"));
        let initial = reflect_config::ReflectConfig::default();
        let missing = Path::new("/nonexistent/workspace/xyz");
        let out = apply_permission_layers(cfg, &initial, missing);
        assert!(out.permission_resolver.is_some());
    }
}
