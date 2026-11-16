import type { Turn, TurnItem, TurnStatus } from './types';

export const EVENT_ID_NONE = '';

export function appendItem(turns: Turn[], turnId: string, item: TurnItem): Turn[] {
  if (turnId === EVENT_ID_NONE) return turns;
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index === -1) {
    return [...turns, { id: turnId, items: [item], status: 'streaming' }];
  }
  return turns.map((turn, i) =>
    i === index ? { ...turn, items: [...turn.items, item] } : turn,
  );
}

export function markTurn(turns: Turn[], turnId: string, status: TurnStatus): Turn[] {
  if (turnId === EVENT_ID_NONE) return turns;
  return turns.map((turn) => (turn.id === turnId ? { ...turn, status } : turn));
}

export function upsertDelta(turns: Turn[], turnId: string, delta: string): Turn[] {
  return mapTurn(turns, turnId, (turn) => {
    const items = [...turn.items];
    const last = items[items.length - 1];
    if (last?.kind === 'assistant_text') {
      items[items.length - 1] = { ...last, text: last.text + delta, streaming: true };
      return { ...turn, items };
    }
    // 只向**末尾**的 assistant_text 拼接。一轮 turn 常含多次模型迭代
    // （文本 → 工具调用 → 文本 …），工具 item 插入后新文本必须另起
    // 气泡，才能与事件流保持时序交错 —— 否则整轮文本都合并进首个
    // 气泡，工具调用在视觉上全部被挤到对话流底部。
    items.push({ kind: 'assistant_text', text: delta, streaming: true });
    return { ...turn, items };
  });
}

export function upsertThinking(
  turns: Turn[],
  turnId: string,
  delta: string,
  variant: 'raw' | 'summary' = 'raw',
): Turn[] {
  return mapTurn(turns, turnId, (turn) => {
    const items = [...turn.items];
    const last = items[items.length - 1];
    // F50:同 variant 的连续增量追加;raw ↔ summary 切换时**新开一条**
    // (两者语义不同,混在一条里会丢失边界)。
    if (last?.kind === 'thinking' && (last.variant ?? 'raw') === variant) {
      items[items.length - 1] = { ...last, text: last.text + delta, variant };
      return { ...turn, items };
    }
    items.push({ kind: 'thinking', text: delta, variant });
    return { ...turn, items };
  });
}

export function finalizeAssistantText(
  turns: Turn[],
  turnId: string,
  text: string,
): Turn[] {
  return mapTurn(turns, turnId, (turn) => {
    const items = [...turn.items];
    const last = items[items.length - 1];
    if (last?.kind === 'assistant_text') {
      items[items.length - 1] = { kind: 'assistant_text', text, streaming: false };
      return { ...turn, items };
    }
    items.push({ kind: 'assistant_text', text, streaming: false });
    return { ...turn, items };
  });
}

function mapTurn(turns: Turn[], turnId: string, map: (turn: Turn) => Turn): Turn[] {
  if (turnId === EVENT_ID_NONE) return turns;
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index === -1) {
    return [...turns, map({ id: turnId, items: [], status: 'streaming' })];
  }
  return turns.map((turn, i) => (i === index ? map(turn) : turn));
}

export function summarizeArgs(args: unknown): string {
  if (args == null) return '';
  try {
    const summary = typeof args === 'string' ? args : JSON.stringify(args);
    return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary;
  } catch {
    return String(args);
  }
}

export interface ToolOutputSummary {
  text: string;
  /** edit/write 类工具产出的 unified diff（ContentBlock::Diff → `type:"diff"`）。 */
  diff?: string;
  /** 工具目标文件路径（ToolOutput.metadata.path）。 */
  path?: string;
}

/**
 * 把协议 `ToolOutput`（或历史回放中的同构对象）归一化为渲染用摘要。
 *
 * - 纯字符串（旧事件 / 简单输出）→ 原样作为 text；
 * - 结构化 `{ content: ContentBlock[], metadata }` → 拼接 text 块、提取
 *   `type:"diff"` 块的 `unified_diff` 与 `metadata.path`；
 * - 其余对象 → JSON 美化兜底（保持旧行为）。
 */
export function summarizeToolOutput(output: unknown): ToolOutputSummary {
  if (output == null) return { text: '' };
  if (typeof output === 'string') return { text: output };
  if (typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.content)) {
      const texts: string[] = [];
      let diff: string | undefined;
      for (const block of o.content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          texts.push(b.text);
        } else if (b.type === 'diff' && typeof b.unified_diff === 'string') {
          diff = b.unified_diff;
        }
      }
      const meta =
        o.metadata && typeof o.metadata === 'object'
          ? (o.metadata as Record<string, unknown>)
          : null;
      const path = meta && typeof meta.path === 'string' ? meta.path : undefined;
      const result: ToolOutputSummary = { text: texts.join('\n').trim() };
      if (diff) result.diff = diff;
      if (path) result.path = path;
      return result;
    }
  }
  try {
    return { text: JSON.stringify(output, null, 2) };
  } catch {
    return { text: String(output) };
  }
}
