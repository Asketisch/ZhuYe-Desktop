/**
 * formatTokens —— token 数值的人类可读缩写(模型能力标签用)。
 *
 * `200000 → "200K"`、`1048576 → "1M"`、`1572864 → "1.6M"`、`8192 → "8K"`。
 * 非正数 / 非有限数返回空串(调用方拼标签时自然省略该段)。
 */

/** 去掉尾随 `.0`(1.0M → 1M),保留一位小数。 */
function trimTrailingZero(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/** token 数值 → 缩写字符串。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1_000_000) {
    return `${trimTrailingZero(Math.round(value / 100_000) / 10)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(Math.round(value));
}
