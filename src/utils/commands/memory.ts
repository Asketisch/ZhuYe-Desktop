/**
 * MEMORY.md scope/key/value 存储封装。
 */
import { invoke } from '../bridge';

export interface ZhuyeMemoryEntry {
  scope: string;
  key: string;
  value: string;
  /** 无标题或存在歧义的旧文件作为整份文档显示。 */
  wholeDocument?: boolean;
}

/** 列出所有 scope 下的 memory 条目。 */
export interface MemoryContext { workspace: string; agent: string }

export async function zhuye_list_memory(expectedContext?: MemoryContext): Promise<ZhuyeMemoryEntry[]> {
  return invoke<ZhuyeMemoryEntry[]>('zhuye_list_memory', expectedContext ? { expectedContext } : undefined);
}

/** 新增或覆盖一条 memory 条目。 */
export async function zhuye_add_memory(
  scope: string, key: string, value: string,
  options: { replaceDocument?: boolean; createOnly?: boolean; expectedContext?: MemoryContext; expectedValue?: string } = {},
): Promise<void> {
  return invoke<void>('zhuye_add_memory', { scope, key, value, ...options });
}

/** 按 scope+key 删除一条 memory 条目。 */
export async function zhuye_remove_memory(scope: string, key: string, replaceDocument = false, expectedContext?: MemoryContext, expectedValue?: string): Promise<void> {
  return invoke<void>('zhuye_remove_memory', { scope, key, ...(replaceDocument ? { replaceDocument: true } : {}), ...(expectedContext ? { expectedContext } : {}), ...(expectedValue !== undefined ? { expectedValue } : {}) });
}
