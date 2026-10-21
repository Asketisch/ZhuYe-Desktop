/**
 * Hook 注册表封装 —— 列表 / 启停 + 事件类型参考。
 */
import { invoke } from '../bridge';

export interface ReflectHookInfo {
  name: string;
  kind: string;
  enabled: boolean;
  config_summary: string;
}

/** 列出已注册的 hooks。 */
export async function reflect_list_hooks(): Promise<ReflectHookInfo[]> {
  return invoke<ReflectHookInfo[]>('reflect_list_hooks');
}

/** 按名称启用或禁用某个 hook。 */
export async function reflect_toggle_hook(name: string, enabled: boolean): Promise<void> {
  return invoke<void>('reflect_toggle_hook', { name, enabled });
}

/**
 * 一个 hook 事件类型。
 *
 * 此前 GUI 只列 hook 的 name / kind / enabled —— 用户不知道**能在哪些时机**
 * 挂 hook、每个时机能做什么决策。核心的 `HookEventKind` 有 12 个变体、
 * `HookDecision` 有 7 种。
 */
export interface HookEventInfo {
  /** 事件名(snake_case,与核心 `HookEventKind` 变体同名)。 */
  kind: string;
  /** 该事件在流程中的位置 / 含义。 */
  description: string;
  /** 该事件上可用的决策。 */
  decisions: string[];
}

/** 列出核心支持的 hook 事件类型与可用决策。 */
export function reflect_list_hook_events(): Promise<HookEventInfo[]> {
  return invoke('reflect_list_hook_events');
}
