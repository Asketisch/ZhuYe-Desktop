/**
 * `[context_windows]` 表的纯 TOML 手术 —— 自 groups.ts 拆出（500 行预算）。
 *
 * 兼容两种形态：引擎 `ContextWindowsSection` 的 Serialize 是 derive 的，
 * 任何一次 `zhuye_save_config` 落盘都会把扁平表重序列化为嵌套的
 * `[context_windows.entries]` 子表（实测存量 config.toml 即此形态）——
 * 只认扁平表头会在保存后永远读回空。混合文档以嵌套为准（引擎 untagged
 * Either 也是先 Flat 失败后落 Nested，嵌套形态下的扁平 kv 会被引擎
 * 静默丢弃，嵌套值才是引擎实读值）。
 */
import { parseHeader, toInt } from './groupToml';

/** 读 context_windows 表（键已小写化；值 = tokens）。表不存在 → 空。 */
export function readContextWindows(toml: string): Record<string, number> {
  const flat: Record<string, number> = {};
  const nested: Record<string, number> = {};
  let scope: 'flat' | 'nested' | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    const header = parseHeader(line);
    if (header) {
      scope =
        header.kind === 'table' && header.name === 'context_windows'
          ? 'flat'
          : header.kind === 'table' && header.name === 'context_windows.entries'
            ? 'nested'
            : null;
      continue;
    }
    if (!scope) continue;
    // 键可带引号（模型名含 '.' 必须引号）—— 宽松匹配引号或 bare key。
    const kv = /^"?([^"=]+)"?\s*=\s*(\d+)\s*$/.exec(line);
    if (!kv) continue;
    const target = scope === 'flat' ? flat : nested;
    target[kv[1].trim().toLowerCase()] = toInt(kv[2]) ?? 0;
  }
  return { ...flat, ...nested };
}

/** 定位 context_windows 表的行区间。返回 `[start, end)`（start = 表头行，
 * end = 下一表头行 / 文件尾）；无表 → null。嵌套形态
 * `[context_windows.entries]` 优先（引擎保存后的规范形态）。 */
function findContextWindowsSpan(lines: string[]): { start: number; end: number } | null {
  let flatStart = -1;
  let nestedStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (!header || header.kind !== 'table') continue;
    if (header.name === 'context_windows' && flatStart === -1) flatStart = i;
    if (header.name === 'context_windows.entries' && nestedStart === -1) nestedStart = i;
  }
  const start = nestedStart !== -1 ? nestedStart : flatStart;
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (parseHeader(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 写/删 context_windows 表里的 `<modelKey>`（tokens = null 删除键；表空时
 * 连同表头一并摘除，不留空段）。modelKey 用**裸模型名**（小写化与引擎
 * 归一化对齐；前缀可覆盖同前缀家族，如 `qwen3.8` 命中 27b/flash）。
 *
 * 目标表优先取既有的 `[context_windows.entries]` 嵌套表（引擎保存后的
 * 规范形态）；两种表都不存在时新开扁平 `[context_windows]`（无 entries
 * 子表时引擎 untagged Either 直接按 Flat 读，扁平形态合法）。**不得**
 * 在嵌套表已存在时另写扁平表 —— 那份 kv 会被引擎的 Nested 分支静默
 * 丢弃（实测「上下文窗口设置不生效」的根因）。 */
export function setGroupContextWindow(
  toml: string,
  modelKey: string,
  tokens: number | null,
): string {
  const key = modelKey.trim().toLowerCase();
  if (!key) return toml;
  const lines = toml.split('\n');
  const span = findContextWindowsSpan(lines);
  if (!span) {
    if (tokens == null) return toml;
    return `${toml.replace(/\s*$/, '')}\n\n[context_windows]\n${keyLineFor(key, tokens)}\n`;
  }
  const { start, end } = span;
  for (let i = start + 1; i < end; i++) {
    const kv = /^"?([^"=]+)"?\s*=\s*\d+\s*$/.exec(lines[i].trim());
    if (kv && kv[1].trim().toLowerCase() === key) {
      if (tokens == null) {
        lines.splice(i, 1);
        // 段空 → 连表头摘除。删行后区间整体前移一格:下一表头从 end 移到
        // end-1,表体即 [start+1, end-1) —— 顺带修掉旧实现用过期 end 计算
        // 摘除范围、会把下一表头一并删掉的越界问题。
        const spanEnd = end - 1;
        const bodyEmpty = !lines.slice(start + 1, spanEnd).some((l) => l.trim());
        if (bodyEmpty) {
          lines.splice(start, spanEnd - start);
        }
        return lines.join('\n').replace(/\n{3,}/g, '\n\n');
      }
      lines[i] = keyLineFor(key, tokens);
      return lines.join('\n');
    }
  }
  if (tokens == null) return toml;
  lines.splice(end, 0, keyLineFor(key, tokens));
  return lines.join('\n');
}

/** context_windows 条目行（键带引号 —— 模型名常含 '.'）。 */
function keyLineFor(key: string, tokens: number): string {
  return `${JSON.stringify(key)} = ${tokens}`;
}
