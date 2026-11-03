/**
 * Agent 定义封装 —— Phase 1 第 3 项。
 *
 * 对应 `src-tauri/src/commands/agents.rs`(其内部封装
 * `zhuye-agent/crates/abilities/zhuye-agent-def`)。每个 agent 是一个带 YAML frontmatter 的
 * Markdown 文件,位于 `~/.zhuye/agents/<name>.md`,与 TUI/CLI 共享。
 *
 * payload 形态与 核心 crate 的 `AgentDefinition` serde shape 一致(snake_case)。
 */
import { invoke } from '../bridge';

// ── 类型(对应 `reflect_agent_def::AgentDefinition`,snake_case) ──────────

export type ReflectMemoryScope = 'project' | 'user' | 'session';

export interface ReflectAgentDef {
  /** 稳定标识,同时作为文件名(`<name>.md`)。 */
  name: string;
  /** 人类可读的描述(必填)。 */
  description: string;
  /** 是否允许其他 agent 派生本 agent。 */
  spawnable: boolean;
  /** 标记为只读(无 write/edit 工具)。 */
  readonly: boolean;
  /** 工具白名单;为空表示允许全部内置工具。 */
  tools: string[];
  /** 工具黑名单。 */
  disallowed_tools: string[];
  /** `Some("inherit")` = 使用调用方模型;`Some(other)` = 覆盖;`null` = 跟随调用方。 */
  model: string | null;
  /** 单轮迭代次数硬上限。 */
  max_turns: number | null;
  /** 需要加载并注入的 memory 范围。 */
  memory: ReflectMemoryScope[];
  /** 预留给 v1 MCP 支持。 */
  mcp_collections: string[];
  /** Markdown 正文(即 system prompt)。 */
  system_prompt: string;
  /**
   * v1.6:system prompt 的来源。
   *
   * - `custom`:用户 md 原文直接用(桌面端读写的 agent 文件恒为此值 ——
   *   上游 parser 对文件来源强制 Custom)。
   * - `builtin_default`:空文案,运行时按当前模型 spec 从提示词库解析
   *   `system.main`。仅引擎自带的默认 agent 走这条路径。
   */
  source: 'custom' | 'builtin_default';
}

// ── Commands ───────────────────────────────────────────────────────────

/** 列出所有 agent 定义(按名称排序)。 */
export async function reflect_list_agent_defs(): Promise<ReflectAgentDef[]> {
  return invoke<ReflectAgentDef[]>('reflect_list_agent_defs');
}

/** 按名称读取单个 agent 定义,未找到时抛错。 */
export async function reflect_get_agent_def(name: string): Promise<ReflectAgentDef> {
  return invoke<ReflectAgentDef>('reflect_get_agent_def', { name });
}

/**
 * 创建或更新 agent 定义。序列化到
 * `~/.zhuye/agents/<name>.md` 并做往返校验。
 * `name` 与 `description` 为必填项。
 */
export async function reflect_save_agent_def(def: ReflectAgentDef, createOnly = false): Promise<ReflectAgentDef> {
  return invoke<ReflectAgentDef>('reflect_save_agent_def', createOnly ? { def, createOnly: true } : { def });
}

/** 删除 agent 定义文件。返回 `true` 表示已删除,`false` 表示未找到。 */
export async function reflect_delete_agent_def(name: string): Promise<boolean> {
  return invoke<boolean>('reflect_delete_agent_def', { name });
}

/** 将 markdown 字符串解析/校验为 agent 定义(无副作用)。 */
export async function reflect_parse_agent_md(text: string): Promise<ReflectAgentDef> {
  return invoke<ReflectAgentDef>('reflect_parse_agent_md', { text });
}

// ====== 活跃 agent ======

/** 某 scope 的记忆文件路径。 */
export interface MemoryScopePath {
  /** scope 名(`project` / `user`)。 */
  scope: string;
  /** `MEMORY.md` 的绝对路径。 */
  path: string;
}

/** 当前活跃 agent 的状态。 */
export interface ActiveAgentInfo {
  /** 活跃 agent 名(决定加载哪条 agent 定义 + 记忆目录)。 */
  name: string;
  /** 是否命中真实的 agent 定义文件(false = 用内置默认定义)。 */
  defFound: boolean;
  /**
   * 该定义声明的 memory 作用域。
   *
   * 空数组 = 不加载任何记忆 —— 此时 Memory 视图里写的内容不会被注入
   * system prompt(核心的设计:记忆按 agent 显式启用)。
   */
  memoryScopes: string[];
  /** 注入预算(核心常量 `MAX_MEMORY_INJECT_CHARS`)。 */
  injectBudgetChars: number;
  /** 各 scope 的记忆文件路径。 */
  memoryPaths: MemoryScopePath[];
}

/** 查询当前活跃 agent(及其记忆作用域 / 注入预算)。 */
export function reflect_get_active_agent(): Promise<ActiveAgentInfo> {
  return invoke('reflect_get_active_agent');
}

/**
 * 设置当前活跃 agent 并立即重绑当前会话(新定义立刻生效)。
 *
 * 桌面端此前硬编码 agent 名 —— GUI 的 Agents 视图是死胡同:能编辑定义,
 * 但运行时永远不加载。设置后 replay 当前会话历史并强制重建线程。
 */
export function reflect_set_active_agent(name: string): Promise<ActiveAgentInfo> {
  return invoke('reflect_set_active_agent', { name });
}
