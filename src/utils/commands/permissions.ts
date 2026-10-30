/**
 * Effort + permission-mode 封装。控制运行中 agent 循环的推理强度
 * 与全局权限门控。
 *
 * 另含**权限规则**只读查询(核心 `reflect-permissions` 三层 store 的生效
 * 规则)—— 让「这个会话到底受哪些规则约束」在 GUI 里可见。
 */
import { invoke } from '../bridge';

/** 设置推理强度等级(provider 定义字符串)。 */
export async function reflect_set_effort(level: string): Promise<string> {
  return invoke<string>('reflect_set_effort', { level });
}

/** 读回当前 reasoning effort("low"|"medium"|"high";pre-install 为 "low")。 */
export async function reflect_get_effort(): Promise<string> {
  return invoke<string>('reflect_get_effort');
}

/** 直接设置 permission mode。 */
export async function reflect_set_permission_mode(mode: string): Promise<string> {
  return invoke<string>('reflect_set_permission_mode', { mode });
}

/** 在可用的 permission mode 之间循环切换。 */
export async function reflect_cycle_permission_mode(): Promise<string> {
  return invoke<string>('reflect_cycle_permission_mode');
}

// ====== 权限规则(只读) ======

/**
 * 规则来源作用域。
 *
 * - `config`  : `config.toml` 的 `[permissions]` 段(会话级,优先级最高)
 * - `project` : `<workspace>/.zhuye/permissions.toml`(项目级)
 * - `user`    : `~/.zhuye/permissions.toml`(用户级,可写)
 */
export type PermissionRuleScope = 'config' | 'project' | 'user';

/** 一条生效的权限规则。 */
export interface PermissionRuleInfo {
  /** 工具名(精确匹配)。 */
  tool: string;
  /** `allow` / `deny` / `ask`。 */
  action: string;
  /** 工具名 glob(设置后忽略 `tool` 的精确匹配语义)。 */
  toolGlob?: string | null;
  /** Bash 命令 glob(仅 Bash 工具 + 有命令上下文时生效)。 */
  shellPattern?: string | null;
  /** 规则来源作用域。 */
  scope: PermissionRuleScope;
}

/**
 * 列出当前生效的权限规则(按作用域优先级排列)。
 *
 * 规则数组顺序即匹配顺序(first-match-wins)—— 前端按数组序展示,
 * 用户能看出「哪条先生效」。
 */
export function reflect_list_permission_rules(): Promise<PermissionRuleInfo[]> {
  return invoke('reflect_list_permission_rules');
}

// ====== 权限规则(可写:用户级) ======

/** 要追加的权限规则。 */
export interface PermissionRuleInput {
  /** 工具名(精确匹配),如 `"Bash"`。 */
  tool: string;
  /** `allow` / `deny` / `ask`。 */
  action: string;
  /** 工具名 glob(设置后忽略 `tool` 的精确匹配语义)。 */
  toolGlob?: string | null;
  /** Bash 命令 glob(仅 Bash 工具 + 有命令上下文时生效)。 */
  shellPattern?: string | null;
}

/**
 * 往**用户级**权限文件(`~/.zhuye/permissions.toml`)追加一条规则。
 *
 * 落盘 + 立即生效 —— 核心的 `StorePermissionResolver` 每次评估都重读
 * 文件,新规则对下一次工具调用即刻生效,无需重启会话。
 *
 * 写的是**核心的**权限文件(CLI 与 GUI 共用),不是桌面端私有的第二套
 * 规则 —— 真值唯一,且同一条规则会出现在 Settings → Permissions 的
 * 「生效的权限规则」列表里。
 */
export function reflect_add_permission_rule(rule: PermissionRuleInput): Promise<void> {
  return invoke<void>('reflect_add_permission_rule', { rule });
}
