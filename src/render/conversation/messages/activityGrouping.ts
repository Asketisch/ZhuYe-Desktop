/**
 * activityGrouping —— 会话流的活动聚合纯函数（render 层，无 hook）。
 *
 * 工具调用 + 思考块混合聚合：思考不再打断工具段（对话式 agent 活动组）。
 *
 *  - 相邻的 tool_call / thinking 进同一活动组；
 *  - 思考与后续工具之间夹着正文时，**不就地**把思考落成独立折叠块：
 *    缓冲只有思考且本轮后面还有工具 → 保留到工具到达，一起成组
 *    （思考最终显示在工具折叠栏内，而不是正文上方另起一栏）；
 *  - 本轮没有任何后续工具 → 思考回落独立折叠块（保持原阅读顺序）。
 *
 * `<think>` 系标签混在正文里的思考在此拆出，和 `thinking_delta` 条目
 * 走同一条聚合路径；正文气泡只保留可见内容。
 */
import type { TurnItem } from '@/contracts/conversation/messageList';
import { splitAssistantText } from './assistantText';

export type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>;
export type ToolOutputItem = Extract<TurnItem, { kind: 'tool_output' }>;
type ThinkingItem = Extract<TurnItem, { kind: 'thinking' }>;
/** 一条工具调用（call + 可选配对的 output）。 */
type ToolEntry = { call: ToolCallItem; output?: ToolOutputItem };
/** 活动段成员：工具调用或思考块 —— 两者穿插出现时同属一个活动组。 */
export type ActivityEntry =
  | { kind: 'tool'; call: ToolCallItem; output?: ToolOutputItem }
  | { kind: 'thinking'; item: ThinkingItem };
export type RenderNode =
  | { kind: 'item'; item: TurnItem }
  | { kind: 'tool'; call: ToolCallItem; output?: ToolOutputItem }
  | { kind: 'toolGroup'; entries: ToolEntry[] }
  | { kind: 'activityGroup'; entries: ActivityEntry[] };

export function isSubagentFollowUp(call: ToolCallItem): boolean {
  if (!call.toolName.startsWith('call_')) return false;
  try {
    const args = JSON.parse(call.argsSummary || call.argsStream || '');
    return typeof args?.session_id === 'string' && args.session_id.length > 0;
  } catch {
    return false;
  }
}

export function groupToolNodes(items: TurnItem[]): RenderNode[] {
  const nodes: RenderNode[] = [];
  const callNodeIdx = new Map<string, number>();
  for (const item of items) {
    if (item.kind === 'tool_call') {
      callNodeIdx.set(item.callId, nodes.length);
      nodes.push({ kind: 'tool', call: item });
    } else if (item.kind === 'tool_output') {
      const idx = callNodeIdx.get(item.callId);
      const node = idx !== undefined ? nodes[idx] : undefined;
      if (idx !== undefined && node?.kind === 'tool' && !node.output) {
        nodes[idx] = { kind: 'tool', call: node.call, output: item };
      } else {
        nodes.push({ kind: 'item', item });
      }
    } else {
      nodes.push({ kind: 'item', item });
    }
  }

  // 本轮最后一个工具调用的位置：决定「思考-only 缓冲」是就地落回
  // 独立折叠块，还是跨过正文等后续工具一起成组。
  let lastToolIdx = -1;
  nodes.forEach((node, i) => {
    if (node.kind === 'tool') lastToolIdx = i;
  });

  const out: RenderNode[] = [];
  let buffer: ActivityEntry[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const tools = buffer.filter(
      (entry): entry is Extract<ActivityEntry, { kind: 'tool' }> => entry.kind === 'tool',
    );
    if (tools.length === 0) {
      // 思考-only 段：不套活动组壳（保持独立思考折叠块）。
      for (const entry of buffer) {
        if (entry.kind === 'thinking') out.push({ kind: 'item', item: entry.item });
      }
    } else if (buffer.length === 1) {
      out.push({ kind: 'tool', call: tools[0].call, output: tools[0].output });
    } else if (tools.length === buffer.length) {
      // 纯工具段（无思考穿插）—— 保持原 ToolGroup 聚合。
      out.push({ kind: 'toolGroup', entries: tools.map(({ call, output }) => ({ call, output })) });
    } else {
      out.push({ kind: 'activityGroup', entries: buffer });
    }
    buffer = [];
  };
  /** 普通内容边界：缓冲里有工具 → 就地收组；只有思考时，若后面还有
   *  工具就跨边界保留，否则就地落回独立折叠块。 */
  const flushAtBoundary = (hasToolLater: boolean) => {
    if (buffer.some((entry) => entry.kind === 'tool') || !hasToolLater) flush();
  };

  nodes.forEach((node, i) => {
    const hasToolLater = i < lastToolIdx;
    if (node.kind === 'tool') {
      buffer.push({ kind: 'tool', call: node.call, output: node.output });
      return;
    }
    if (node.kind !== 'item') {
      // toolGroup / activityGroup 节点只由 flush 产出，配对后的输入流里
      // 不会出现 —— 保守透传即可。
      flushAtBoundary(hasToolLater);
      out.push(node);
      return;
    }
    const item = node.item;
    if (item.kind === 'thinking') {
      buffer.push({ kind: 'thinking', item });
      return;
    }
    if (item.kind === 'assistant_text') {
      // 思考与正文同条消息（<think> 标签）时拆开：思考进活动缓冲，
      // 正文按普通气泡渲染。思考先入缓冲，边界判定决定「并入后续
      // 工具组」还是「独立折叠块」。
      const { thinking, content } = splitAssistantText(item.text);
      if (thinking) {
        buffer.push({ kind: 'thinking', item: { kind: 'thinking', text: thinking } });
      }
      if (content) {
        flushAtBoundary(hasToolLater);
        out.push({ kind: 'item', item: { ...item, text: content } });
      } else if (!thinking) {
        flushAtBoundary(hasToolLater);
        out.push(node);
      }
      return;
    }
    flushAtBoundary(hasToolLater);
    out.push(node);
  });
  flush();
  return out;
}
