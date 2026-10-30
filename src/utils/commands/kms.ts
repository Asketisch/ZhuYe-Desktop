/**
 * KMS（知识管理系统）IPC 包装。
 *
 * Phase 3 条目 12：基于 grep 的 wiki + /dream 会话挖掘。
 */
import { invoke } from '@/utils/bridge';

// ── 类型（camelCase，对齐 Rust serde(rename_all = "camelCase")）────────────────────

export interface ReflectWikiInfo {
  name: string;
  description: string | null;
  path: string;
  pageCount: number;
  modifiedAtMs: number;
}

export interface ReflectPage {
  name: string;
  wiki: string;
  content: string;
  title: string | null;
  tags: string[];
  modifiedAtMs: number;
}

export interface ReflectSearchResult {
  wiki: string;
  page: string;
  lines: string[];
  lineCount: number;
}

export interface ReflectDreamResult {
  insights: string[];
  sessionsAnalyzed: number;
  wiki: string;
  page: string;
}

// ── Wrappers ──

export function reflect_kms_list(): Promise<ReflectWikiInfo[]> {
  return invoke('reflect_kms_list');
}

export function reflect_kms_create(
  name: string,
  description: string | null,
): Promise<ReflectWikiInfo> {
  return invoke('reflect_kms_create', { name, description });
}

export function reflect_kms_delete(name: string): Promise<void> {
  return invoke('reflect_kms_delete', { name });
}

export function reflect_kms_save_page(
  wiki: string,
  page: string,
  content: string,
  title: string | null,
  tags: string[] | null,
  createOnly = false,
  expectedContent?: string,
): Promise<ReflectPage> {
  return invoke('reflect_kms_save_page', { wiki, page, content, title, tags, ...(createOnly ? { createOnly } : {}), ...(expectedContent !== undefined ? { expectedContent } : {}) });
}

export function reflect_kms_get_page(wiki: string, page: string): Promise<ReflectPage> {
  return invoke('reflect_kms_get_page', { wiki, page });
}

export function reflect_kms_list_pages(wiki: string): Promise<ReflectPage[]> {
  return invoke('reflect_kms_list_pages', { wiki });
}

export function reflect_kms_search(query: string): Promise<ReflectSearchResult[]> {
  return invoke('reflect_kms_search', { query });
}

export function reflect_dream(insights: string[], sessionsAnalyzed: number): Promise<ReflectDreamResult> {
  return invoke('reflect_dream', { insights, sessionsAnalyzed });
}
