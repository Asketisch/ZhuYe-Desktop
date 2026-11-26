/**
 * Provider 图标 —— models.dev 官方 icons 目录。
 *
 * `https://models.dev/icons/<provider>.svg`（ZCode 同款来源，minimax /
 * deepseek / zai 等均已收录）。按组信息推导 provider key：组 id 精确
 * 优先，base_url 关键词兜底（聚合站 / 中转域名不直接是 provider 名）。
 * 加载失败（网络 / 无该图标）由调用方回退字母 monogram —— 图标是
 * 增强不是依赖。
 */

/** 关键词 → models.dev provider id（base_url / 组 id 命中即用）。 */
const KEYWORD_MAP: [RegExp, string][] = [
  [/bigmodel/i, 'zai'],
  [/minimax/i, 'minimax'],
  [/deepseek/i, 'deepseek'],
  [/moonshot/i, 'moonshotai'],
  [/dashscope|qwen|aliyun/i, 'qwen'],
  [/openrouter/i, 'openrouter'],
  [/ollama/i, 'ollama'],
  [/anthropic/i, 'anthropic'],
  [/openai/i, 'openai'],
  [/google|gemini|generativelanguage/i, 'google'],
  [/mistral/i, 'mistral'],
  [/xai|grok/i, 'xai'],
  [/together/i, 'together'],
  [/groq/i, 'groq'],
  [/fireworks/i, 'fireworks'],
  [/volc|doubao/i, 'volcengine'],
  [/siliconflow/i, 'siliconflow'],
];

/** 推导 provider 的 models.dev id（图标 key）。无把握时返回组 id 小写
 * （models.dev 覆盖面广，同名即命中；不命中由 onerror 回退字母）。 */
export function providerKeyOf(group: { id: string; label: string; endpoint: string; baseUrl: string }): string {
  const id = group.id.trim().toLowerCase();
  if (id && !['openai', 'anthropic', 'ollama'].includes(id)) {
    // 自定义组 id 常就是 provider 名（如 "minimax" / "zai"）。
    return id;
  }
  const haystack = `${group.id} ${group.label} ${group.baseUrl}`;
  for (const [pattern, key] of KEYWORD_MAP) {
    if (pattern.test(haystack)) return key;
  }
  return group.endpoint.toLowerCase() === 'ollama' ? 'ollama' : id || 'openai';
}

/** models.dev icons 目录的 SVG 地址。 */
export function providerIconUrl(group: { id: string; label: string; endpoint: string; baseUrl: string }): string {
  return `https://models.dev/icons/${providerKeyOf(group)}.svg`;
}
