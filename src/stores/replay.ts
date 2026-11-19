import type { ReflectRolloutRecord } from '@/utils/types';
import type { CompactionStats, PlanDocState, Turn, TurnItem, UserAttachmentMeta } from './agent/types';
import { summarizeArgs, summarizeToolOutput } from './agent/turns';

/**
 * 从 rollout record 流提取最后一份 plan 终稿(`plan_ready` record,markdown
 * 全文入盘)—— 会话重放后 Inspector「计划」tab 据此恢复 plan 正文。
 *
 * `plan_draft_updated` 不持久化,草稿重载后不可恢复(终稿可)。
 * 决策状态(approved/rejected)不在 jsonl 里(plan_approved/rejected 不落盘),
 * 统一按 `ready` 恢复 —— 正文可见性优先,状态标注只在 live 会话内有效。
 */
export function planFromRollout(records: ReflectRolloutRecord[]): PlanDocState | null {
  let plan: PlanDocState | null = null;
  for (const record of records) {
    if (record.type !== 'plan_ready') continue;
    const planId = typeof record.plan_id === 'string' ? record.plan_id : '';
    const markdown = typeof record.markdown === 'string' ? record.markdown : '';
    if (!planId || !markdown) continue;
    plan = {
      planId,
      markdown,
      path: typeof record.path === 'string' ? record.path : null,
      status: 'ready',
    };
  }
  return plan;
}

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
 *
 * A2:用户侧附件在回放里还原 —— `image` 块(0-255 字节数组)转 data-URL
 * 缩略图;引擎把 `UserInputItem::File` 展开成的独立 `@path(:Ls-Le)` 文本
 * 块解析回文件 chip(只认整块匹配,用户正文里手打的 `@xxx` 不受影响)。
 */
function contentToItems(content: unknown, role: string): TurnItem[] {
  if (role !== 'user' && role !== 'assistant') return [];

  if (typeof content === 'string') {
    const text = stripInjectedSystemBlocks(content.trim());
    return text ? [textItem(role, text)] : [];
  }
  if (!Array.isArray(content)) return [];

  const items: TurnItem[] = [];
  /** 相邻附件块合并进同一个 user_attachments item(chip 行视觉成组)。 */
  const pushAttachment = (attachment: UserAttachmentMeta) => {
    const last = items[items.length - 1];
    if (last?.kind === 'user_attachments') {
      items[items.length - 1] = { kind: 'user_attachments', attachments: [...last.attachments, attachment] };
    } else {
      items.push({ kind: 'user_attachments', attachments: [attachment] });
    }
  };
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'text': {
        const raw = typeof b.text === 'string' ? b.text.trim() : '';
        if (!raw) break;
        // 引擎注入的环境上下文 / AGENTS.md 项目指令以 `<system-reminder>`
        // 包裹后**随用户输入一并落盘**(role 仍是 user)。回放时它们会冒充
        // 用户发言渲染成气泡 —— 这里剥掉,只保留用户真实正文。
        // 后端 `records_to_preload` 不受影响:模型侧上下文保持原样。
        const text = stripInjectedSystemBlocks(raw);
        if (!text) break;
        // 引擎 File item 的落盘形态:独立文本块 `@path` / `@path:Ls-Le`。
        const mention = FILE_MENTION_RE.exec(text);
        if (role === 'user' && mention) {
          pushAttachment(
            mention[2]
              ? {
                  kind: 'file',
                  path: mention[1],
                  range: { start_line: Number(mention[2]), end_line: Number(mention[3]) },
                }
              : { kind: 'file', path: mention[1] },
          );
          break;
        }
        items.push(textItem(role, text));
        break;
      }
      case 'image': {
        const mime = typeof b.mime_type === 'string' ? b.mime_type : 'image/png';
        if (!Array.isArray(b.data)) break;
        pushAttachment({ kind: 'image', src: `data:${mime};base64,${bytesToBase64(b.data as number[])}`, mime });
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
        // 其余块(diff 等)已由 tool_result 提取,不进历史视图。
        break;
    }
  }
  return items;
}

/** 独立 `@path(:Ls-Le)` 文本块 —— 引擎 `UserInputItem::File` 的落盘形态。 */
const FILE_MENTION_RE = /^@(\S+?)(?::L(\d+)-L(\d+))?$/;

/**
 * 引擎注入块包裹标签 —— `<system-reminder>…</system-reminder>`。
 *
 * 注入通道:`app-core/src/prompt_env.rs` 的 `EnvContextHook`(环境上下文)
 * 与 `AgentsMdHook`(AGENTS.md 项目指令)经 `HookDecision::InjectMessage`
 * 注入,引擎包装成 `<system-reminder>` 的 user 文本块,与用户输入**同批
 * 落盘**(role=user)。回放时必须剥除,否则注入内容会冒充用户发言。
 */
const INJECTED_BLOCK_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/**
 * 剥除文本里的引擎注入块(`<system-reminder>…</system-reminder>`)。
 *
 * 返回剥除后的正文(首尾空白已裁剪);剥完为空 → 返回 `''`,调用方丢弃
 * 该文本块。注入块通常独占一个 ContentBlock,但也允许与用户正文同块 ——
 * 两种形态都要能剥干净。
 */
export function stripInjectedSystemBlocks(text: string): string {
  if (!text.includes('<system-reminder>')) return text.trim();
  return text.replace(INJECTED_BLOCK_RE, '').trim();
}

/** 0-255 字节数组 → base64(分块拼接,防超长数组爆调用栈)。 */
function bytesToBase64(bytes: number[]): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

function textItem(role: string, text: string): TurnItem {
  return role === 'user' ? { kind: 'user_text', text } : { kind: 'assistant_text', text };
}
