//! DAG 流水线 —— GUI 对应 CLI `reflect pipeline run / team`。
//!
//! 两条入口,均镜像 CLI 的组装(registry 从配置引导、`REFLECT_MODEL=mock`
//! 可离线跑通、factory 不带 recorder):
//! - [`run_team_pipeline`]:用已注册 team(`~/.reflect/teams/`)跑四阶段
//!   预设(plan → prd → exec → verify),对应 `reflect pipeline team`;
//! - [`run_pipeline_config`]:读 TOML DAG 配置跑任意拓扑,
//!   对应 `reflect pipeline run -c`。
//!
//! 返回结构化 `PipelineReport`(不打印 stdout、不写输出文件)。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use reflect_pipeline::{FailurePolicy, Pipeline, PipelineContext, PipelineReport};
use reflect_protocol::ThreadId;
use reflect_subagent::SubAgentFactory;
use reflect_task::{FileTaskStore, FileTeamStore, TaskManager};
use reflect_tools::ToolRegistry;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// 流水线运行错误。
#[derive(Debug)]
pub enum PipelineRunError {
    /// 配置读 / 解析失败。
    Config(String),
    /// TaskManager / store 初始化失败。
    Store(String),
    /// provider / factory 组装失败。
    Factory(String),
    /// 运行失败(节点执行 / team 不存在等)。
    Run(String),
}

impl std::fmt::Display for PipelineRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PipelineRunError::Config(m) => write!(f, "pipeline config: {m}"),
            PipelineRunError::Store(m) => write!(f, "pipeline store init: {m}"),
            PipelineRunError::Factory(m) => write!(f, "pipeline factory: {m}"),
            PipelineRunError::Run(m) => write!(f, "pipeline run: {m}"),
        }
    }
}

impl std::error::Error for PipelineRunError {}

/// 构造默认 TaskManager(走 `~/.reflect/tasks/` 与 `~/.reflect/teams/`,
/// 与 GUI squad/tasks 命令共享同一存储)。
pub fn build_task_manager() -> Result<Arc<TaskManager>, PipelineRunError> {
    let task_store = FileTaskStore::with_default_home()
        .map_err(|e| PipelineRunError::Store(format!("FileTaskStore init: {e}")))?;
    let team_store = FileTeamStore::with_default_home()
        .map_err(|e| PipelineRunError::Store(format!("FileTeamStore init: {e}")))?;
    Ok(Arc::new(TaskManager::new(
        Arc::new(task_store),
        Arc::new(team_store),
    )))
}

/// 构造 SubAgentFactory —— 镜像 CLI `build_factory`:registry 从配置
/// 引导(含 `REFLECT_MODEL=mock` 离线注册),默认 model 用 resolved spec,
/// 无 recorder(GUI 侧 spawn 的子 agent 各自走自己的 session)。
pub fn build_subagent_factory() -> Result<Arc<SubAgentFactory>, PipelineRunError> {
    let cfg = reflect_config::load_default();
    let registry = Arc::new(reflect_llm::ModelRegistry::new());
    cfg.apply_to_registry(&registry)
        .map_err(|e| PipelineRunError::Factory(format!("build provider from config: {e}")))?;
    let model = cfg
        .resolved_model_spec()
        .unwrap_or_else(|| "openai/gpt-4o".to_string());
    Ok(Arc::new(SubAgentFactory::new(
        ThreadId::new(),
        model,
        registry,
        None,
        Arc::new(ToolRegistry::default()),
        CancellationToken::new(),
        None,
    )))
}

/// 用已注册 team 跑四阶段预设 pipeline(plan → prd → exec → verify)。
pub async fn run_team_pipeline(
    manager: Arc<TaskManager>,
    team_name: &str,
    topic: &str,
) -> Result<PipelineReport, PipelineRunError> {
    if topic.trim().is_empty() {
        return Err(PipelineRunError::Config("topic must be non-empty".into()));
    }
    let factory = build_subagent_factory()?;
    reflect_pipeline::run_team_pipeline(
        manager,
        team_name,
        topic.to_string(),
        factory,
        CancellationToken::new(),
    )
    .await
    .map_err(|e| PipelineRunError::Run(e.to_string()))
}

/// pipeline TOML 校验结果(供 GUI 编辑器实时反馈)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineConfigSummary {
    /// 流水线名。
    pub name: String,
    /// 失败策略(缺省 `abort`)。
    pub failure_policy: String,
    /// 节点标签列表(按字典序)。
    pub nodes: Vec<String>,
    /// 节点总数。
    pub node_count: usize,
    /// `runner = "team"` 但 team 未注册的节点标签。
    pub missing_teams: Vec<String>,
    /// 校验是否通过(配置级 + wiring 级错误都在核心的 `from_toml` 里暴露)。
    pub valid: bool,
    /// 校验错误文本(不通过时给出核心的错误)。
    pub error: Option<String>,
}

/// 校验一段 pipeline TOML,返回结构摘要。
///
/// 之前 GUI 只能「跑」一个已有的 TOML 文件,不能改 —— 用户要新增一个拓扑
/// 只能手写文件、跑失败才知道写错了。本函数让编辑器**边写边验**:
/// 结构摘要(节点 / 依赖 team)由 TOML 直接读出,配置级 + wiring 级错误
/// 交由核心的 `Pipeline::from_toml` 判定(与实际运行同一条校验路径)。
pub async fn validate_pipeline_config(
    manager: Arc<TaskManager>,
    toml_src: &str,
) -> Result<PipelineConfigSummary, PipelineRunError> {
    let team_index = build_team_index(&manager).await?;

    // 结构摘要:只认顶层 `nodes` 表 —— 节点内部字段交给核心校验,不在
    // 这里复刻核心的 schema(避免两份定义漂移)。
    let value: toml::Value = toml::from_str(toml_src)
        .map_err(|e| PipelineRunError::Config(format!("parse toml: {e}")))?;
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let failure_policy = value
        .get("failure_policy")
        .and_then(|v| v.as_str())
        .unwrap_or("abort")
        .to_string();
    let mut nodes: Vec<String> = Vec::new();
    let mut missing_teams: Vec<String> = Vec::new();
    if let Some(table) = value.get("nodes").and_then(|v| v.as_table()) {
        for (label, def) in table {
            nodes.push(label.clone());
            let runner = def.get("runner").and_then(|v| v.as_str()).unwrap_or("team");
            if runner == "team" && !team_index.contains_key(label) {
                missing_teams.push(label.clone());
            }
        }
    }
    nodes.sort();
    missing_teams.sort();

    // 真实校验:核心的 `from_toml`(与运行同一条路径)。
    let validation = Pipeline::from_toml(toml_src, |label, runner, params| {
        let Some(team) = team_index.get(label) else {
            return None;
        };
        reflect_pipeline::nodes::default_runner_for(label, runner, params, |_| Some(team.clone()))
    });

    Ok(match validation {
        Ok(_) => PipelineConfigSummary {
            name,
            failure_policy,
            node_count: nodes.len(),
            nodes,
            missing_teams,
            valid: true,
            error: None,
        },
        Err(e) => PipelineConfigSummary {
            name,
            failure_policy,
            node_count: nodes.len(),
            nodes,
            missing_teams,
            valid: false,
            error: Some(e.to_string()),
        },
    })
}

/// 读 TOML DAG 配置跑任意拓扑(对应 CLI `reflect pipeline run -c`)。
///
/// `failure_policy`:`"abort"` / `"continue_collect"`(可选);
/// `inputs`:模板 `{{input.<key>}}` 引用的自定义输入。
pub async fn run_pipeline_config(
    manager: Arc<TaskManager>,
    config_path: &Path,
    topic: &str,
    failure_policy: Option<&str>,
    inputs: HashMap<String, String>,
) -> Result<PipelineReport, PipelineRunError> {
    if topic.trim().is_empty() {
        return Err(PipelineRunError::Config("topic must be non-empty".into()));
    }
    let toml_src = std::fs::read_to_string(config_path)
        .map_err(|e| PipelineRunError::Config(format!("read {}: {e}", config_path.display())))?;

    let factory = build_subagent_factory()?;

    // 预加载全部 team 到本地 HashMap(from_toml 的 runner_for 闭包是
    // 同步签名,无法直接 await manager.get_team —— 与 CLI 相同取舍)。
    let team_index = build_team_index(&manager).await?;

    let pipeline = Pipeline::from_toml(&toml_src, |label, runner, params| {
        let Some(team) = team_index.get(label) else {
            tracing::warn!(
                "pipeline node '{label}' requires team '{label}' (create it in Squad view first)"
            );
            return None;
        };
        reflect_pipeline::nodes::default_runner_for(label, runner, params, |_| Some(team.clone()))
    })
    .map_err(|e| PipelineRunError::Config(e.to_string()))?;

    let mut pipeline = pipeline;
    if let Some(p) = failure_policy {
        let parsed = FailurePolicy::parse(p)
            .map_err(|e| PipelineRunError::Config(format!("invalid failure_policy: {e}")))?;
        pipeline = pipeline.with_failure_policy(parsed);
    }

    let ctx = PipelineContext {
        topic: topic.to_string(),
        inputs,
        factory: factory.clone(),
        manager: manager.clone(),
        cancel: CancellationToken::new(),
        human_gate: None,
    };

    pipeline
        .run(ctx)
        .await
        .map_err(|e| PipelineRunError::Run(e.to_string()))
}

/// 预加载 `~/.reflect/teams/` 下全部 team(节点 label → TeamFile)。
async fn build_team_index(
    manager: &Arc<TaskManager>,
) -> Result<HashMap<String, reflect_task::TeamFile>, PipelineRunError> {
    let teams = manager
        .list_teams()
        .await
        .map_err(|e| PipelineRunError::Store(format!("list teams: {e}")))?;
    Ok(teams.into_iter().map(|t| (t.name.clone(), t)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_task_manager_uses_default_home() {
        // 冷环境也可能无目录;store 初始化应能创建默认 home。
        let m = build_task_manager();
        assert!(m.is_ok(), "got: {:?}", m.err());
    }

    #[tokio::test]
    async fn run_team_pipeline_missing_team_reports_run_error() {
        let manager = build_task_manager().unwrap();
        let err = run_team_pipeline(manager, "__no_such_team__", "demo topic")
            .await
            .unwrap_err();
        assert!(matches!(err, PipelineRunError::Run(_)), "got: {err}");
    }

    #[tokio::test]
    async fn run_pipeline_config_rejects_bad_toml() {
        let manager = build_task_manager().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.toml");
        std::fs::write(&path, "not [valid").unwrap();
        let err = run_pipeline_config(manager, &path, "t", None, HashMap::new())
            .await
            .unwrap_err();
        assert!(matches!(err, PipelineRunError::Config(_)), "got: {err}");
    }

    #[tokio::test]
    async fn run_pipeline_config_rejects_empty_topic() {
        let manager = build_task_manager().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.toml");
        std::fs::write(&path, "[pipeline]\nname = \"x\"\n").unwrap();
        let err = run_pipeline_config(manager, &path, "  ", None, HashMap::new())
            .await
            .unwrap_err();
        assert!(matches!(err, PipelineRunError::Config(_)), "got: {err}");
    }

    /// 校验摘要:节点列表 + 缺 team 的节点 + 校验结论。
    ///
    /// 关键点:**校验走核心的 `from_toml`**(与实际运行同一条路径),所以
    /// 「GUI 说通过」就等于「跑得起来」—— 不会两套校验漂移。
    #[tokio::test]
    async fn validate_pipeline_config_summarises_nodes_and_missing_teams() {
        let manager = build_task_manager().unwrap();
        let toml_src = r#"
name = "demo"
failure_policy = "abort"

[nodes.plan]
runner = "team"

[nodes.build]
runner = "team"
depends_on = ["plan"]
"#;
        let summary = validate_pipeline_config(manager, toml_src).await.unwrap();
        assert_eq!(summary.name, "demo");
        assert_eq!(summary.failure_policy, "abort");
        assert_eq!(summary.nodes, vec!["build".to_string(), "plan".to_string()]);
        assert_eq!(summary.node_count, 2);
        // 没有任何 team 注册 → 两个节点都缺 team。
        assert_eq!(summary.missing_teams.len(), 2);
        // 缺 team 属于 wiring 级错误 → 校验不通过。
        assert!(!summary.valid);
        assert!(summary.error.is_some());
    }

    #[tokio::test]
    async fn validate_pipeline_config_reports_toml_parse_error() {
        let manager = build_task_manager().unwrap();
        let err = validate_pipeline_config(manager, "not [valid")
            .await
            .unwrap_err();
        assert!(matches!(err, PipelineRunError::Config(_)), "got: {err}");
    }
}
