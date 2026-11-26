/**
 * promptSwitched —— 「提示词已刷新」提示的判定(纯函数)。
 *
 * v1.13:切会话时 `syncSessionPromptSelection` 会下发 `Select`,引擎
 * 必回 `prompt_switched` 事件 —— 但**内容可能完全没变**(同一 selection
 * 解析出同一组生效层)。此前 reducer 不比较新旧直接弹 toast,于是每次
 * 切会话都冒出一条「提示词已刷新」,而用户什么都没看到。
 *
 * 这里抽出比较逻辑(独立文件 —— `reducer.ts` 已达行数预算,不能就地撑大):
 * 只有**生效结果真的变了**才提示;纯时间戳刷新不提示。
 */
import type { PromptState } from './types';
import type { PromptSelection } from '@/utils/commands/prompts';

/** `prompt_switched` 事件里与「生效结果」有关的字段。 */
export interface PromptSwitchedOutcome {
  /** 重扫/切换后当前 spec 命中的用户层。 */
  activeLayers: string[];
  /** 当前生效的选择策略。 */
  selection?: PromptSelection;
  /** 当前请求使用的方案。 */
  profile?: string;
}

/**
 * 两个提示词选择是否等价。
 *
 * 与 `promptSelection.ts::sameSelection` 同款语义,但那处在 stores 层
 * 读 localStorage 记录,此处面向事件负载 —— 保持两份实现同步:语义上
 * `null`/缺省 = 跟随全局默认,与 `{mode:'default'}` **不等价**(前者是
 * 「无覆盖」,后者是「显式覆盖为 default」)。
 */
function sameSelection(a: PromptSelection | undefined, b: PromptSelection | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'manual' && b.mode === 'manual') return a.profile === b.profile;
  return true;
}

/** 两个层名清单是否逐项相同(顺序敏感 —— 生效层是有序叠加的)。 */
function sameLayers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((layer, i) => layer === b[i]);
}

/**
 * 是否该提示「提示词已刷新」。
 *
 * - 没有旧状态(首次 `prompt_switched`)→ 提示(用户确实换了提示词);
 * - 生效层 / 选择 / 方案三者全同 → **不提示**(纯时间戳刷新);
 * - 任一不同 → 提示。
 */
export function shouldToastPromptSwitched(
  prev: PromptState | null,
  next: PromptSwitchedOutcome,
): boolean {
  if (!prev) return true;
  if (!sameLayers(prev.activeLayers ?? [], next.activeLayers ?? [])) return true;
  if (!sameSelection(prev.selection, next.selection)) return true;
  if ((prev.profile ?? '') !== (next.profile ?? '')) return true;
  return false;
}
