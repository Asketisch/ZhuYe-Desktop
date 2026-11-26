/**
 * fuzzy —— 轻量级模糊匹配(B10-01)。
 *
 * 给定 query 与 list,返回 [(item, score)] 按 score 降序;
 * score < 0 表示未匹配。规则:
 *   - 子序列匹配(字符按顺序出现),case-insensitive
 *   - 命中开头得高分,连续匹配得更高分
 *   - 完全相等得最高分
 *
 * **i18n-aware**:用 `getLabel` / `getHint` 回调提供当前 locale 文本,
 * 避免依赖 `item.label` / `item.hint` 字段名(可能不存在)。
 */
export interface FuzzyHit<T> {
  item: T;
  score: number;
  /** 匹配的源文本索引，用于高亮显示。 */
  matches: number[];
}

export interface FuzzyOptions<T> {
  getLabel?: (item: T) => string;
  getHint?: (item: T) => string | undefined;
  getKeywords?: (item: T) => string[] | undefined;
}

export function fuzzy<T>(
  query: string,
  list: T[],
  options: FuzzyOptions<T> = {},
): FuzzyHit<T>[] {
  const getLabel = options.getLabel ?? ((item: any) => item.label ?? '');
  const getHint = options.getHint ?? ((item: any) => item.hint);
  const getKeywords = options.getKeywords ?? ((item: any) => item.keywords);
  const q = query.trim().toLowerCase();
  if (!q) return list.map((item) => ({ item, score: 0, matches: [] }));
  const hits: FuzzyHit<T>[] = [];
  for (const item of list) {
    const label = getLabel(item);
    const hint = getHint(item);
    const keywords = getKeywords(item);
    const haystacks: { text: string; boost: number }[] = [
      { text: label, boost: 2 },
      ...(keywords ?? []).map((k: string) => ({ text: k, boost: 1.5 })),
      ...(hint ? [{ text: hint, boost: 0.5 }] : []),
    ];
    let bestScore = -1;
    let bestMatches: number[] = [];
    for (const { text, boost } of haystacks) {
      const r = scoreOne(q, text.toLowerCase());
      if (r.score < 0) continue;
      const s = r.score * boost;
      if (s > bestScore) {
        bestScore = s;
        bestMatches = r.matches;
      }
    }
    if (bestScore >= 0) {
      hits.push({ item, score: bestScore, matches: bestMatches });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

function scoreOne(q: string, text: string): { score: number; matches: number[] } {
  if (text === q) return { score: 100, matches: text.split('').map((_, i) => i) };
  if (text.startsWith(q)) {
    return { score: 50, matches: Array.from({ length: q.length }, (_, i) => i) };
  }
  // 子序列匹配
  const matches: number[] = [];
  let qi = 0;
  let run = 0;
  let bestRun = 0;
  let score = 0;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] === q[qi]) {
      matches.push(i);
      run += 1;
      bestRun = Math.max(bestRun, run);
      score += 1;
      if (run > 1) score += 2 * (run - 1);
      qi += 1;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return { score: -1, matches: [] };
  // 紧凑匹配的额外加分
  if (bestRun === q.length) score += 8;
  if (matches.length > 0 && matches[matches.length - 1] - matches[0] === q.length - 1) score += 4;
  return { score, matches };
}