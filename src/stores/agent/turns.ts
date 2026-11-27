import type { Turn, TurnItem, TurnStatus, UserAttachmentMeta } from './types';
import type { UserInputItem } from '@/types/protocol';
import { isImageMarkerText } from './policy/imageProvenance';

export const EVENT_ID_NONE = '';

/**
 * 提交的 UserInputItem 列表 → 可渲染附件元数据(A2)。
 * - `image`(base64/data-URL 内联)→ 缩略图元数据;
 * - `file`(路径 mention)→ 文件 chip 元数据(含行区间);
 * - 图片来源标记文本(imageProvenance,紧贴在图片前的独立文本块)不产生
 *   附件展示,挂到紧随其后的 image meta.source 上;
 * - 其余 `text` / `skill` / `local_image`(遗留占位)不产生附件展示。
 */
export function userAttachmentsFromItems(items: UserInputItem[]): UserAttachmentMeta[] {
  const out: UserAttachmentMeta[] = [];
  /** 待挂来源:标记文本只对紧随其后的图片生效,被其他 item 隔断即失效。 */
  let pendingSource: string | undefined;
  for (const item of items) {
    if (item.type === 'text') {
      const trimmed = item.text.trim();
      pendingSource = isImageMarkerText(trimmed) ? trimmed : undefined;
    } else if (item.type === 'image') {
      out.push({
        kind: 'image',
        src: item.data,
        mime: item.mime_type,
        ...(pendingSource ? { source: pendingSource } : {}),
      });
      pendingSource = undefined;
    } else if (item.type === 'file') {
      out.push(item.range ? { kind: 'file', path: item.path, range: item.range } : { kind: 'file', path: item.path });
      pendingSource = undefined;
    } else {
      // skill / local_image:不产生附件展示,也不消费标记(标记只指向图片)。
      pendingSource = undefined;
    }
  }
  return out;
}

/**
 * 轮内用户内容 → 可重发的 UserInputItem 列表(C2 一键重生成用)。
 * `user_text` → text item;`user_attachments` 逆转回 image / file item
 * (image 的 src 为 data-URL,后端 `normalize_image_data` 会解码)。
 * image 携带来源标记原文时按原位重发标记 item —— 重生成的提交与原提交
 * 语境一致(否则出处信息在第二次发送时丢失)。
 * 找不到用户内容(纯助手轮 / 错误轮)返回 null。
 */
export function userItemsFromTurn(turn: Turn): UserInputItem[] | null {
  const items: UserInputItem[] = [];
  let hasUser = false;
  for (const item of turn.items) {
    if (item.kind === 'user_text') {
      if (item.text.trim()) items.push({ type: 'text', text: item.text });
      hasUser = true;
    } else if (item.kind === 'user_attachments') {
      for (const att of item.attachments) {
        if (att.kind === 'image') {
          if (att.source) items.push({ type: 'text', text: att.source });
          items.push({ type: 'image', data: att.src, mime_type: att.mime });
        } else {
          items.push(att.range ? { type: 'file', path: att.path, range: att.range } : { type: 'file', path: att.path });
        }
      }
      hasUser = true;
    }
  }
  return hasUser ? items : null;
}

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

/**
 * v1.10:按 id 终结 turn;id 匹配不到时兜底把**最后一个 streaming turn**
 * 标记为 aborted。
 *
 * 用途:`turn_aborted` 的 `event.id` 在极端时序下可能配不上任何本地
 * turn —— 引擎在空闲期收到中断时会回一条「现编 turn_id」的回执
 * (用户点停止时回合恰好已结束),前端按 id 查找落空 → 状态零变化,
 * 表现为「停止按钮点了没反应」。兜底保证用户意图(停止)总能解卡。
 */
export function abortTurnOrLatestStreaming(turns: Turn[], turnId: string): Turn[] {
  if (turnId !== EVENT_ID_NONE && turns.some((turn) => turn.id === turnId)) {
    return markTurn(turns, turnId, 'aborted');
  }
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].status === 'streaming') {
      const next = [...turns];
      next[i] = { ...next[i], status: 'aborted' };
      return next;
    }
  }
  return turns;
}

/**
 * v1.10:清空该 turn 末尾「仍在流式生成」的内容(模型调用失败将自动
 * 重试,重试从头生成 —— 半成品必须丢弃,否则两次输出拼接)。
 *
 * 只从尾部向上剔除「未完成」条目:
 * - `assistant_text` 且 `streaming: true`;
 * - `thinking`(思考增量没有 streaming 标记,但已完成步骤后必然跟着
 *   工具结束/输出,尾部的 thinking 只可能来自本次失败尝试);
 * - `tool_call` 且 `status: 'running'`(参数半途中断,未执行)。
 *
 * 已完成的工具调用与输出保留 —— 它们在上游引擎里已落盘、可能已有副作用,
 * 重试不会重放它们。
 */
export function resetStreamingOutput(turns: Turn[], turnId: string): Turn[] {
  if (turnId === EVENT_ID_NONE) return turns;
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index === -1) return turns;
  return turns.map((turn, i) => {
    if (i !== index) return turn;
    const items = [...turn.items];
    while (items.length > 0) {
      const last = items[items.length - 1];
      const inFlight =
        (last.kind === 'assistant_text' && last.streaming === true) ||
        last.kind === 'thinking' ||
        (last.kind === 'tool_call' && last.status === 'running');
      if (!inFlight) break;
      items.pop();
    }
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

export function summarizeArgs(args: unknown, toolName?: string): string {
  if (args == null) return '';
  try {
    const summary = typeof args === 'string' ? args : JSON.stringify(args);
    if (summary.length > 200 && toolName?.startsWith('call_')) {
      let parsed: unknown = args;
      if (typeof args === 'string') {
        try { parsed = JSON.parse(args); } catch { parsed = null; }
      }
      if (parsed && typeof parsed === 'object' && 'session_id' in parsed && typeof parsed.session_id === 'string') {
        const prompt = 'prompt' in parsed && typeof parsed.prompt === 'string' ? parsed.prompt : '';
        return JSON.stringify({ session_id: parsed.session_id, prompt: `${prompt.slice(0, 100)}…` });
      }
    }
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
