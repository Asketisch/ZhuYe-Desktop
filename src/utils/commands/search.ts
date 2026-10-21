/**
 * Find-in-files 封装 —— 在工作区内做 grep 搜索。
 */
import { invoke } from '../bridge';

export interface ReflectFileSearchHit {
  path: string;
  line: number;
  context: string;
}

export interface ReflectFileSearchResult {
  root: string;
  query: string;
  hits: ReflectFileSearchHit[];
  truncated: boolean;
}

/**
 * 搜索排序方式。
 *
 * - `substring`:子串匹配(默认,快)
 * - `bm25`:BM25 相关性排序 —— 与 agent 自己的 grep 工具**同款**
 *   (同一份分词 + 排序实现,`k1=1.2` / `b=0.75`)。
 */
export type SearchRank = 'substring' | 'bm25';

/**
 * 在工作区内做搜索。
 *
 * @param query  待搜索文本
 * @param path   根路径,或 `null` 表示当前工作区
 * @param maxResults  结果上限(默认 200)
 * @param rank   排序方式(默认子串匹配)
 */
export async function reflect_search_files(
  query: string,
  path: string | null = null,
  maxResults = 200,
  rank: SearchRank = 'substring',
): Promise<ReflectFileSearchResult | null> {
  return invoke<ReflectFileSearchResult | null>('reflect_search_files', {
    query,
    path,
    maxResults,
    rank,
  });
}
