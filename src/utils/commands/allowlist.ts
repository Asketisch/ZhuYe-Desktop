/**
 * 审批 allowlist 封装 —— 按前缀匹配的"始终允许"规则。
 */
import { invoke } from '../bridge';

export interface ZhuyeAllowlist {
  prefixes: string[];
}

/** 加载持久化的 allowlist(无规则时返回 `null`)。 */
export async function zhuye_load_allowlist(): Promise<ZhuyeAllowlist | null> {
  return invoke<ZhuyeAllowlist | null>('zhuye_load_allowlist');
}

/** 整体保存 allowlist。 */
export async function zhuye_save_allowlist(list: ZhuyeAllowlist): Promise<void> {
  return invoke<void>('zhuye_save_allowlist', { list });
}

/** 检查给定命令前缀是否已被加入 allowlist。 */
export async function zhuye_check_allowlist(prefix: string): Promise<boolean | null> {
  return invoke<boolean | null>('zhuye_check_allowlist', { prefix });
}
