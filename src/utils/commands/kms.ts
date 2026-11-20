/**
 * KMS（知识管理系统）IPC 包装。
 *
 * Phase 3 条目 12：基于 grep 的 wiki + /dream 会话挖掘。
 */
import { invoke } from '@/utils/bridge';

// ── 类型（camelCase，对齐 Rust serde(rename_all = "camelCase")）────────────────────

export interface ZhuyeWikiInfo {
  name: string;
  description: string | null;
  path: string;
  pageCount: number;
  modifiedAtMs: number;
}

export interface ZhuyePage {
  name: string;
  wiki: string;
  content: string;
  title: string | null;
  tags: string[];
  modifiedAtMs: number;
}

export interface ZhuyeSearchResult {
  wiki: string;
  page: string;
  lines: string[];
  lineCount: number;
}

export interface ZhuyeDreamResult {
  insights: string[];
  sessionsAnalyzed: number;
  wiki: string;
  page: string;
}

// ── Wrappers ──

export function zhuye_kms_list(): Promise<ZhuyeWikiInfo[]> {
  return invoke('zhuye_kms_list');
}

export function zhuye_kms_create(
  name: string,
  description: string | null,
): Promise<ZhuyeWikiInfo> {
  return invoke('zhuye_kms_create', { name, description });
}

export function zhuye_kms_delete(name: string): Promise<void> {
  return invoke('zhuye_kms_delete', { name });
}

export function zhuye_kms_save_page(
  wiki: string,
  page: string,
  content: string,
  title: string | null,
  tags: string[] | null,
  createOnly = false,
  expectedContent?: string,
): Promise<ZhuyePage> {
  return invoke('zhuye_kms_save_page', { wiki, page, content, title, tags, ...(createOnly ? { createOnly } : {}), ...(expectedContent !== undefined ? { expectedContent } : {}) });
}

export function zhuye_kms_get_page(wiki: string, page: string): Promise<ZhuyePage> {
  return invoke('zhuye_kms_get_page', { wiki, page });
}

export function zhuye_kms_list_pages(wiki: string): Promise<ZhuyePage[]> {
  return invoke('zhuye_kms_list_pages', { wiki });
}

export function zhuye_kms_search(query: string): Promise<ZhuyeSearchResult[]> {
  return invoke('zhuye_kms_search', { query });
}

export function zhuye_dream(insights: string[], sessionsAnalyzed: number): Promise<ZhuyeDreamResult> {
  return invoke('zhuye_dream', { insights, sessionsAnalyzed });
}
