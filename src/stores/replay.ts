import type { ReflectRolloutRecord } from '@/utils/types';
import type { CompactionStats, Turn, TurnItem } from './agent/types';
import { summarizeArgs, summarizeToolOutput } from './agent/turns';

/**
 * 把 `reflect_replay_session` 返回的 rollout record 流构建为转数列表 +
 * 压缩聚合统计。
 *
 * 线格式为 `reflect_protocol::RolloutRecord` —— serde tagged union
 * (tag = `type`,snake_case),每条 record 是一个扁平对象:
 *
 * - `{ type: "message", turn_id, role, content }` —— `content` 是纯字符串
 *   或 `ContentBlock` 数组(`text` / `tool_use` / `tool_result` / `image` /
 *   `diff`);同一 turn 内 user 与 assistant 消息共享 `turn_id`;
 * - `{ type: "compaction", turn_id, strategy, removed_count, summary }` ——
 *   不进对话流,聚合进 `compactions`(与 live `context_compacted` 一致,
 *   仅 Inspector 概览展示;record 无 token 数,`tokensSaved` 不含历史);
 * - 其余(`session_meta` / `token_count` / `plan_*` / `checkpoint` / ...)
 *   不承载 turn 级渲染信息,跳过。
 *
 * turn 按 `turn_id` 分组,顺序 = 文件中首次出现顺序(chronological);
 * 历史 turn 一律 `status: 'done'`。
 */
export function turnsFromRollout(records: ReflectRolloutRecord[]): {
  turns: Turn[];
  compactions: CompactionStats;
} {
  const turns: Turn[] = [];
  const index = new Map<string, number>();
  const ensureTurn = (turnId: string): Turn => {
    const existing = index.get(turnId);
    if (existing !== undefined) return turns[existing];
    const turn: Turn = { id: turnId, items: [], status: 'done' };
    index.set(turnId, turns.length);
    turns.push(turn);
    return turn;
  };
  const compactions: CompactionStats = {
    count: 0,
    removedMessages: 0,
    tokensSaved: 0, // 历史 record 不带 token 数,仅 live 事件累计。
    last: null,
    records: [], // 历史压缩无 before/after 明细,只累计计数。
  };

  for (const record of records) {
    const type = typeof record.type === 'string' ? record.type : '';
    const turnId = typeof record.turn_id === 'string' ? record.turn_id : '';

    if (type === 'message') {
      if (!turnId) continue;
      const role = typeof record.role === 'string' ? record.role : '';
      const items = contentToItems(record.content, role);
      if (items.length > 0) ensureTurn(turnId).items.push(...items);
    } else if (type === 'compaction') {
      // 不展开完整 `summary`(可达 16 KiB 的合成消息正文),只取统计字段。
      const strategy = typeof record.strategy === 'string' ? record.strategy : 'compact';
      const removed = typeof record.removed_count === 'number' ? record.removed_count : 0;
      compactions.count += 1;
      compactions.removedMessages += removed;
      compactions.last = `${strategy}: ${removed} msgs`;
    }
    // 其余 record 类型 → skip。
  }
  return { turns, compactions };
}

/**
 * 把 `message` record 的 `content`(字符串或 ContentBlock 数组)转成
 * TurnItem 列表。只渲染 user / assistant 两种 role —— `system` / `tool`
 * 角色的持久化记录不进入历史视图(tool 输出已由 assistant 消息里的
 * `tool_result` 块承载)。
 */
function contentToItems(content: unknown, role: string): TurnItem[] {
  if (role !== 'user' && role !== 'assistant') return [];

  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [textItem(role, text)] : [];
  }
  if (!Array.isArray(content)) return [];

  const items: TurnItem[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'text': {
        const text = typeof b.text === 'string' ? b.text.trim() : '';
        if (text) items.push(textItem(role, text));
        break;
      }
      case 'tool_use': {
        const callId = typeof b.id === 'string' ? b.id : '';
        if (!callId) break;
        items.push({
          kind: 'tool_call',
          toolName: typeof b.name === 'string' ? b.name : 'tool',
          argsSummary: summarizeArgs(b.args),
          callId,
          status: 'done',
        });
        break;
      }
      case 'tool_result': {
        const callId = typeof b.call_id === 'string' ? b.call_id : '';
        const output = (b.output ?? {}) as Record<string, unknown>;
        if (!callId) break;
        // 整体交给 summarizeToolOutput：text 块拼接 + diff 块提取
        // （edit/write 的改动在历史视图中同样可见）。
        const summary = summarizeToolOutput(output);
        if (!summary.text && !summary.diff) break;
        items.push({
          kind: 'tool_output',
          callId,
          text: summary.text,
          diff: summary.diff,
          path: summary.path,
          isError: Boolean(output.is_error),
        });
        break;
      }
      default:
        // image 等块暂不进历史视图(base64 负载);diff 已由 tool_result 提取。
        break;
    }
  }
  return items;
}

function textItem(role: string, text: string): TurnItem {
  return role === 'user' ? { kind: 'user_text', text } : { kind: 'assistant_text', text };
}
