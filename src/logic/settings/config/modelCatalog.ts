/**
 * 供应商模型清单的前端 TTL 缓存 —— 「自动拉取」的编排层。
 *
 * 引擎侧的清单发现（fetch_catalog）自带进程内 300s TTL 缓存，但 GUI
 * 展示走的是直连 HTTP 的 `reflect_list_provider_models`（保留了
 * display_name / supports_vision 等展示字段）。这里在前端补一层
 * 5 分钟 memo + 在途去重，让「保存组后自动拉取 / 打开卡片自动拉取 /
 * Composer 挂载自动拉取」不会每次都打网络 —— 频繁打开设置页时
 * 命中缓存零开销，刷新按钮传 `{ refresh: true }` 强制绕过。
 *
 * 缓存键 = endpoint + base_url + api_key（内存态，不落盘、不进
 * localStorage；API key 不离开进程）。
 */

import { reflect_list_provider_models, type ProviderModelInfo } from '@/utils/commands';

/** 缓存 TTL：与引擎清单发现缓存的 300s 同量级。 */
const CACHE_TTL_MS = 5 * 60_000;

interface CacheSlot {
  at: number;
  models: ProviderModelInfo[];
}

const cache = new Map<string, CacheSlot>();
const inflight = new Map<string, Promise<ProviderModelInfo[]>>();

function cacheKey(baseUrl: string, apiKey: string, endpoint: string): string {
  return `${endpoint}|${baseUrl}|${apiKey}`;
}

/** 拉取指定端点的模型清单（TTL 缓存 + 在途去重）。
 * `refresh` = 强制绕过缓存重新打网络（手动刷新按钮用）。 */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  opts?: { refresh?: boolean },
): Promise<ProviderModelInfo[]> {
  const key = cacheKey(baseUrl, apiKey, endpoint);
  if (!opts?.refresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.models;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const promise = reflect_list_provider_models(baseUrl, apiKey, endpoint)
    .then((res) => {
      cache.set(key, { at: Date.now(), models: res.models });
      return res.models;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** 清空缓存（测试隔离用；生产不需要 —— TTL 自过期）。 */
export function clearModelCatalogCache(): void {
  cache.clear();
  inflight.clear();
}
