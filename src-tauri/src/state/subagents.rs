//! 子代理 + 任务 + 笔记工具的注册 —— 让桌面端 agent **真正能用**这些能力。
//!
//! ## 为什么需要
//!
//! 桌面端的工具注册表此前只有 15 个内置工具(Bash / Read / Write / …),
//! **不包含**:
//! - 任务工具(`reflect_task::register_task_tools`)—— agent 无法驱动 GUI
//!   里的任务板(只能人手在 GUI 里 CRUD);
//! - 会话笔记工具(`reflect_notes::AddSessionNoteTool`)—— agent 无法写
//!   会话笔记(GUI 的笔记面板因此永远是空的);
//! - 子代理工具(`call_<role>`)—— agent 无法委派子任务(Inspector 的
//!   子代理区块因此永远是空的)。
//!
//! CLI 三族都注册(`reflect-exec` 的 `bootstrap_m5` + `headless.rs` 的
//! `register_task_tools`)。两个前端能力不一致 —— GUI 展示了任务板 /
//! 子代理 / 笔记,agent 却用不上。
//!
//! ## 子代理 spec 的合并口径(与 CLI 同款)
//!
//! 优先级 **TOML `[[subagents]]` > workspace `.reflect/subagents/*.md`
//! > home `~/.reflect/subagents/*.md` > 硬编码 explorer**(仅当全空时)。
//!
//! `call_<role>` 是运行时动态注册的工具,不在静态 `ALWAYS_ON_TOOLS` 里;
//! 必须显式补进 `m4.skills` 的 always-on 可见集 —— 否则模型请求里没有
//! 子代理工具的 schema,LLM 永远无法委派。

use std::path::Path;
use std::sync::Arc;

use reflect_core::config::M4Deps;
use reflect_llm::SharedModelRegistry;
use reflect_protocol::ThreadId;
use reflect_subagent::{CallSubAgentTool, SubAgentFactory, SubAgentSpec};
use reflect_tools::{ToolRegistry, ToolSource};
use tokio_util::sync::CancellationToken;

/// 注册任务工具(任务板的操作面)。
///
/// 桌面端此前只有 GUI 侧的任务 CRUD,agent 侧没有任务工具 —— GUI 里
/// 建的 task,agent 既看不到也改不了。
pub(crate) fn register_task_tools(
    tools: &Arc<ToolRegistry>,
    task_manager: Arc<reflect_task::TaskManager>,
) {
    reflect_task::register_task_tools(tools, task_manager);
}

/// 注册会话笔记工具。
///
/// 笔记落盘到 `<notes_home>/session-notes/<thread_id>.jsonl` —— 与
/// `commands/notes.rs` 的读取面同源。**每个会话一个 store**(路径含
/// thread id),所以 rebind 时要重新注册(同名覆盖)。
pub(crate) fn register_note_tool(tools: &Arc<ToolRegistry>, m4: &M4Deps) {
    let tool: Arc<dyn reflect_tools::Tool> = Arc::new(reflect_notes::AddSessionNoteTool::new(
        m4.note_store.clone(),
    ));
    tools.register_with_source(ToolSource::Runtime, tool);
}

/// 构建子代理工厂并注册 `call_<role>` 工具。
///
/// 返回工厂句柄(供后续热重载更新默认模型 / 注入插件 spec)。
#[allow(clippy::too_many_arguments)]
pub(crate) fn bootstrap_subagents(
    workspace: &Path,
    model: &str,
    registry: &SharedModelRegistry,
    thread_id: ThreadId,
    parent_recorder: Option<Arc<dyn reflect_protocol::RolloutRecorder>>,
    m4: &M4Deps,
    tools: &Arc<ToolRegistry>,
    cfg: &reflect_config::ReflectConfig,
) -> Arc<SubAgentFactory> {
    // v1.x 功能 1:从 `[subagent_providers]` 段构建独立 child registry,
    // 让 subagent 用独立的 base_url + api_key + model。`None` = 父子共享。
    let child_registry: Option<SharedModelRegistry> = cfg.to_child_registry().map(Arc::new);
    // 无 recorder(占位线程)→ NullRecorder:子代理的审计记录丢弃,不影响
    // 其执行。
    let recorder: Arc<dyn reflect_protocol::RolloutRecorder> =
        parent_recorder.unwrap_or_else(|| Arc::new(reflect_protocol::NullRecorder));
    let factory = Arc::new(SubAgentFactory::new(
        thread_id,
        model.to_string(),
        registry.clone(),
        child_registry,
        tools.clone(),
        CancellationToken::new(),
        Some(recorder),
    ));
    // 注入 M4Deps 里的 subagent registry —— `CallSubAgentTool::execute` 写
    // + `pre_loop` 读走同一 Arc。
    factory.set_subagent_registry(m4.subagent_registry.clone());
    // 注入父 skills catalog,让 subagent 也能 LoadSkill / 使用 skill。
    factory.set_parent_skills(m4.skills.clone());

    // 合并 spec(TOML > workspace md > home md)。
    let home = std::env::var("HOME").unwrap_or_default();
    let home_path = Path::new(&home);
    let home_md = reflect_subagent::load_subagents_dir(&home_path.join(".reflect/subagents"))
        .unwrap_or_default();
    let ws_md = reflect_subagent::load_subagents_dir(&workspace.join(".reflect/subagents"))
        .unwrap_or_default();
    let toml_specs = cfg.subagents.clone();
    let mut configs = reflect_subagent::merge_by_priority(vec![home_md, ws_md, toml_specs]);

    // 全部源为空 → 回落硬编码 explorer(向后兼容,同 CLI)。
    if configs.is_empty() {
        configs.push(reflect_config::SubagentSpecConfig {
            name: "Explorer".into(),
            role: "explorer".into(),
            model: None,
            system_prompt: reflect_prompt::library()
                .resolve("")
                .get_or(
                    "subagent.explorer",
                    "You are an explorer subagent. Inspect the codebase and return a concise summary.",
                )
                .into(),
            allowed_tools: vec!["bash".into(), "read".into(), "grep".into(), "glob".into()],
            allowed_skills: vec![],
            max_turns: None,
        });
    }

    // `call_<role>` 是运行时动态注册的工具,不在静态 ALWAYS_ON_TOOLS 里
    // —— 必须补进 always-on 可见集,否则模型请求里没有子代理工具的
    // schema,LLM 永远无法委派。
    let call_tool_names: Vec<String> = configs
        .iter()
        .map(|sc| format!("call_{}", sc.role))
        .collect();

    for sc in configs {
        let spec = SubAgentSpec {
            name: sc.name,
            role: sc.role.clone(),
            model: sc.model,
            system_prompt: sc.system_prompt,
            allowed_tools: sc.allowed_tools,
            data_transfer: Default::default(),
            max_turns: sc.max_turns,
            allowed_skills: sc.allowed_skills,
        };
        let role = sc.role;
        let tool: Arc<dyn reflect_tools::Tool> =
            Arc::new(CallSubAgentTool::new(factory.clone(), spec));
        // v1.3:走 `register_runtime_tool` 应用 Runtime 源安全 floor。
        tools.register_runtime_tool(tool);
        tracing::debug!(role = %role, "registered subagent spec");
    }

    m4.skills.add_always_on_tools(call_tool_names);
    factory
}
