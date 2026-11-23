import { Brain, Wrench, AlertTriangle, MessageSquare, FileDiff, GitBranch, RotateCcw, Pencil, RefreshCw, ChevronsRight } from 'lucide-react';
import type { MessageListSlots, MessageListViewProps, Turn, TurnItem } from '@/contracts/messageList';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { splitAssistantText } from './assistantText';
import s from './MessageList.module.css';

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>;
type ToolOutputItem = Extract<TurnItem, { kind: 'tool_output' }>;
type ThinkingItem = Extract<TurnItem, { kind: 'thinking' }>;
/** 一条工具调用（call + 可选配对的 output）。 */
type ToolEntry = { call: ToolCallItem; output?: ToolOutputItem };
/** 活动段成员：工具调用或思考块 —— 两者穿插出现时同属一个活动组。 */
type ActivityEntry = { kind: 'tool'; call: ToolCallItem; output?: ToolOutputItem } | { kind: 'thinking'; item: ThinkingItem };
type RenderNode =
  | { kind: 'item'; item: TurnItem }
  | { kind: 'tool'; call: ToolCallItem; output?: ToolOutputItem }
  | { kind: 'toolGroup'; entries: ToolEntry[] }
  | { kind: 'activityGroup'; entries: ActivityEntry[] };

/** 工具调用 + 思考块混合聚合：思考不再打断工具段（对话式 agent 活动组）。
 *  思考-only 段（无任何工具调用）保持独立 ThinkingCollapsible，不套组壳。 */
function groupToolNodes(items: TurnItem[]): RenderNode[] {
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
  // 连续的「活动」（工具调用/思考块穿插）聚合成组：会话默认只露一行摘要，
  // 组内是紧凑状态行；单条工具调用（前后无思考）保持独立行。
  // 思考-only 段直接落回 item 节点（沿用 ThinkingCollapsible 折叠）。
  const out: RenderNode[] = [];
  let buffer: Array<{ tool?: ToolEntry; thinking?: ThinkingItem }> = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const tools = buffer.filter((b) => b.tool).map((b) => b.tool!);
    if (tools.length === 0) {
      // 思考-only 段：不套活动组壳。
      for (const b of buffer) out.push({ kind: 'item', item: b.thinking! });
    } else if (buffer.length === 1 && tools.length === 1) {
      out.push({ kind: 'tool', call: tools[0].call, output: tools[0].output });
    } else if (tools.length === buffer.length) {
      // 纯工具段（无思考穿插）—— 保持原 ToolGroup 聚合。
      out.push({ kind: 'toolGroup', entries: tools });
    } else {
      out.push({ kind: 'activityGroup', entries: buffer.map((b) => b.tool ? { kind: 'tool', ...b.tool } : { kind: 'thinking', item: b.thinking! }) });
    }
    buffer = [];
  };
  for (const node of nodes) {
    if (node.kind === 'tool') {
      buffer.push({ tool: { call: node.call, output: node.output } });
    } else if (node.kind === 'item' && node.item.kind === 'thinking') {
      buffer.push({ thinking: node.item });
    } else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

export function MessageList({ t, turns, scrollRef, onForkTurn, onRewindTurn, onEditTurn,
  onRegenerateTurn, onContinueTurn, slots }: MessageListViewProps) {
  const { QueuedMessages } = slots;
  return (
    <div className={s.scroll} ref={scrollRef} role="log" aria-label={t('chat.ariaLabel')} aria-live="polite" aria-atomic="false">
      <div className={s.inner}>
        {turns.length === 0 && (
          <div className={s.emptyWrap}>
            <Icon icon={MessageSquare} size={32} className={s.emptyIcon} />
            <p className={s.emptyTitle}>{t('chat.empty.title')}</p>
            <p className={s.emptyHint}>{t('chat.empty.hint')}</p>
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnView
            key={turn.id}
            turn={turn}
            index={i}
            isLast={i === turns.length - 1}
            onForkTurn={onForkTurn}
            onRewindTurn={onRewindTurn}
            onEditTurn={onEditTurn}
            onRegenerateTurn={onRegenerateTurn}
            onContinueTurn={onContinueTurn}
            t={t}
            slots={slots}
          />
        ))}
        <QueuedMessages />
      </div>
    </div>
  );
}

function TurnView({
  turn,
  index,
  isLast = false,
  onForkTurn,
  onRewindTurn,
  onEditTurn,
  onRegenerateTurn,
  onContinueTurn,
  t,
  slots,
}: {
  turn: Turn;
  index: number;
  t: MessageListViewProps['t'];
  slots: MessageListSlots;
  isLast?: boolean;
  onForkTurn?: (turnId: string, branch: string) => void;
  onRewindTurn?: (turnId: string) => void;
  onEditTurn?: (turnId: string) => void;
  onRegenerateTurn?: (turnId: string) => void;
  onContinueTurn?: (turnId: string) => void;
}) {
  const nodes = groupToolNodes(turn.items);
  // 流式中的 turn 尚未落全（rollout 记录还在追加），不作为 fork 点；
  // 历史回放与已结束的 turn 均可「从此轮（含）分叉」。
  const canFork = Boolean(onForkTurn) && turn.status !== 'streaming';
  // rewind 丢弃「此轮(含)之后」的对话记录(引擎 Op::Rewind),同样只对
  // 已落全的 turn 开放;与 fork 并列在 hover 动作行。
  const canRewind = Boolean(onRewindTurn) && turn.status !== 'streaming';
  // v1.11 F7+D6:编辑历史 —— 只对含用户文本、已落全的 turn 开放
  // (组合 Rewind + composer 预填,见 ChatView.handleEditTurn)。
  const canEdit =
    Boolean(onEditTurn) &&
    turn.status !== 'streaming' &&
    turn.items.some((it) => it.kind === 'user_text');
  // C2 一键重生成:含用户内容(文本或附件)、已落全的轮可重发。
  const canRegenerate =
    Boolean(onRegenerateTurn) &&
    turn.status !== 'streaming' &&
    turn.items.some((it) => it.kind === 'user_text' || it.kind === 'user_attachments');
  // C3 继续生成:仅末轮且已有助手产出 —— 引擎无 Continue Op,提交一条
  // 续写指令开新 turn(显式近似,见 ChatView.handleContinueTurn)。
  const canContinue =
    Boolean(onContinueTurn) &&
    isLast &&
    turn.status !== 'streaming' &&
    turn.items.some((it) => it.kind === 'assistant_text');
  return (
    <div className={s.turn}>
      {nodes.map((node, i) => (
        <ItemView
          // diff 输出到达时重挂载,让 defaultOpen 生效（流式期间 output
          // 是后到的,同一节点从无到有）。
          key={`${i}-${node.kind === 'tool' && node.output?.diff ? 'diff' : node.kind}`}
          node={node}
          turnStatus={turn.status}
          t={t}
          slots={slots}
        />
      ))}
      {(canFork || canRewind || canRegenerate || canContinue) && (
        <div className={s.turnActions}>
          {canContinue && (
            <IconButton
              size="sm"
              label={t('chat.continueGeneration')}
              onClick={() => onContinueTurn?.(turn.id)}
              data-testid={`turn-continue-${turn.id}`}
            >
              <Icon icon={ChevronsRight} size={12} />
            </IconButton>
          )}
          {canRegenerate && (
            <IconButton
              size="sm"
              label={t('chat.regenerate')}
              onClick={() => onRegenerateTurn?.(turn.id)}
              data-testid={`turn-regenerate-${turn.id}`}
            >
              <Icon icon={RefreshCw} size={12} />
            </IconButton>
          )}
          {canRewind && (
            <IconButton
              size="sm"
              label={t('chat.rewindToHere')}
              onClick={() => onRewindTurn?.(turn.id)}
              data-testid={`turn-rewind-${turn.id}`}
            >
              <Icon icon={RotateCcw} size={12} />
            </IconButton>
          )}
          {canEdit && (
            <IconButton
              size="sm"
              label={t('chat.editToHere')}
              onClick={() => onEditTurn?.(turn.id)}
              data-testid={`turn-edit-${turn.id}`}
            >
              <Icon icon={Pencil} size={12} />
            </IconButton>
          )}
          {canFork && (
            <IconButton
              size="sm"
              label={t('chat.forkFromHere')}
              onClick={() => onForkTurn?.(turn.id, `fork@${index + 1}`)}
              data-testid={`turn-fork-${turn.id}`}
            >
              <Icon icon={GitBranch} size={12} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

function ItemView({ node, turnStatus, t, slots }: { node: RenderNode; turnStatus: Turn['status']; t: MessageListViewProps['t']; slots: MessageListSlots }) {
  const { ToolCell, ToolOutputBody, UserAttachments, Collapsible, ToolGroup, ActivityGroup } = slots;

  if (node.kind === 'activityGroup') {
    // 工具 + 思考混合段：思考不打断工具流,同组折叠（对话式 agent 产品惯例）。
    const entryMeta = node.entries.map((entry) =>
      entry.kind === 'thinking'
        ? { thinking: true }
        : { toolName: entry.call.toolName, status: entry.call.status },
    );
    return (
      <ActivityGroup entries={entryMeta}>
        {node.entries.map((entry, i) =>
          entry.kind === 'thinking' ? (
            <ThinkingCollapsible key={`th-${i}-${entry.item.text.length}`} text={entry.item.text} compact summaryLabel={entry.item.variant === 'summary'} t={t} Collapsible={Collapsible} />
          ) : (
            <ToolCell
              key={entry.call.callId}
              flat
              toolName={entry.call.toolName}
              argsSummary={entry.call.argsSummary}
              argsStream={entry.call.argsStream}
              status={entry.call.status}
              output={
                entry.output
                  ? {
                      text: entry.output.text,
                      diff: entry.output.diff,
                      path: entry.output.path,
                      isError: entry.output.isError,
                      guardVerdict: entry.output.guardVerdict,
                    }
                  : undefined
              }
              defaultOpen={Boolean(entry.output?.diff)}
            />
          ),
        )}
      </ActivityGroup>
    );
  }

  if (node.kind === 'toolGroup') {
    // 连续工具调用的聚合组：摘要行写明用了哪些工具，展开后逐条列出。
    const names: string[] = [];
    for (const entry of node.entries) {
      if (!names.includes(entry.call.toolName)) names.push(entry.call.toolName);
    }
    // 组内有 diff 输出时默认展开 —— 改动内容不该被折叠藏起来。
    const hasDiff = node.entries.some((entry) => Boolean(entry.output?.diff));
    return (
      <ToolGroup toolNames={names} count={node.entries.length} defaultOpen={hasDiff}>
        {node.entries.map((entry) => (
          <ToolCell
            // diff 输出到达时重挂载,让 defaultOpen 生效（流式期间 output
            // 是后到的,同一节点从无到有）。
            key={`${entry.call.callId}-${entry.output?.diff ? 'diff' : 'flat'}`}
            flat
            toolName={entry.call.toolName}
            argsSummary={entry.call.argsSummary}
            argsStream={entry.call.argsStream}
            status={entry.call.status}
            output={
              entry.output
                ? {
                    text: entry.output.text,
                    diff: entry.output.diff,
                    path: entry.output.path,
                    isError: entry.output.isError,
                    guardVerdict: entry.output.guardVerdict,
                  }
                : undefined
            }
            defaultOpen={Boolean(entry.output?.diff)}
          />
        ))}
      </ToolGroup>
    );
  }

  if (node.kind === 'tool') {
    return (
      <ToolCell
        toolName={node.call.toolName}
        argsSummary={node.call.argsSummary}
        argsStream={node.call.argsStream}
        status={node.call.status}
        output={
          node.output
            ? {
                text: node.output.text,
                diff: node.output.diff,
                path: node.output.path,
                isError: node.output.isError,
                guardVerdict: node.output.guardVerdict,
              }
            : undefined
        }
        defaultOpen={Boolean(node.output?.diff)}
      />
    );
  }

  const item = node.item;
  switch (item.kind) {
    case 'user_text':
      return <UserBubble text={item.text} CopyButton={slots.CopyButton} />;

    case 'user_attachments':
      return <UserAttachments attachments={item.attachments} />;

    case 'assistant_text': {
      const streaming = item.streaming === true && turnStatus === 'streaming';
      return <AssistantBubble text={item.text} streaming={streaming} t={t} slots={slots} />;
    }

    case 'thinking':
      // F50:summary(推理摘要)与 raw(流式思考)区分渲染 —— 语义不同,
      // 摘要带专属标签(与引擎 ThinkingDeltaKind::Summary →
      // ReasoningSummary 的路由语义一致)。
      return item.variant === 'summary' ? (
        <ThinkingCollapsible text={item.text} summaryLabel t={t} Collapsible={slots.Collapsible} />
      ) : (
        <ThinkingCollapsible text={item.text} t={t} Collapsible={slots.Collapsible} />
      );

    case 'tool_output': {
      // 孤儿输出（无配对 tool_call）—— 回放数据可能缺 tool_use 块。
      if (item.diff) {
        return (
          <Collapsible
            icon={<Icon icon={FileDiff} size={13} />}
            accent="default"
            label={item.path || t('chat.diffLabel')}
            defaultOpen
          >
            <ToolOutputBody text={item.text} diff={item.diff} isError={item.isError} />
          </Collapsible>
        );
      }
      return (
        <Collapsible
          icon={<Icon icon={Wrench} size={13} />}
          accent={item.isError ? 'danger' : 'default'}
          label={item.isError ? t('chat.outputError') : t('chat.output')}
        >
          <ToolOutputBody text={item.text} isError={item.isError} />
        </Collapsible>
      );
    }

    case 'error':
      return (
        <div className={s.errorRow}>
          <Icon icon={AlertTriangle} size={14} />
          <span>{item.text}</span>
        </div>
      );

    default:
      return null;
  }
}

/** C1 气泡级复制按钮:复制成功换对勾 1.5s(与代码块复制同款反馈)。 */
function UserBubble({ text, CopyButton }: { text: string; CopyButton: MessageListSlots['CopyButton'] }) {
  return (
    <div className={s.userRow}>
      <div className={s.userBubble}>{text}</div>
      <CopyButton text={text} testId="user-copy" />
    </div>
  );
}

/** 思考过程折叠块（ThinkingDelta 事件与正文 <think> 分段共用）。
 *  文字用弱化色 —— 思考与正式输出视觉分级。compact=活动组内的单行态。 */
function ThinkingCollapsible({ text, defaultOpen = false, summaryLabel = false, compact = false, t, Collapsible }: {
  text: string; defaultOpen?: boolean; summaryLabel?: boolean; compact?: boolean;
  t: MessageListViewProps['t']; Collapsible: MessageListSlots['Collapsible'];
}) {
  const snippet = text.slice(0, 60).replace(/\s+/g, ' ');
  const label = summaryLabel
    ? t('chat.thinkingSummary')
    : text.length > 60
      ? t('chat.thinkingWith', { snippet })
      : t('chat.thinking');
  return (
    <div className={compact ? s.thinkingCompact : undefined}>
      <Collapsible
        icon={<Icon icon={Brain} size={13} />}
        accent={summaryLabel ? 'success' : 'info'}
        defaultOpen={defaultOpen}
        label={label}
      >
        <pre className={`${s.monoText} ${s.thinkingText}`}>{text}</pre>
      </Collapsible>
    </div>
  );
}

function AssistantBubble({ text, streaming, t, slots }: { text: string; streaming: boolean; t: MessageListViewProps['t']; slots: MessageListSlots }) {
  const { Markdown, Collapsible, CopyButton } = slots;
  // 模型把推理以 <think> 标签混进正文、runtime 的 nudge 提醒会让模型
  // 回显 FINAL ANSWER 标记 —— 都不属于正文,渲染前分段/剥离。
  const { thinking, content } = splitAssistantText(text);
  return (
    <div className={s.assistantRow}>
      <div className={s.assistantAvatar} aria-hidden="true">R</div>
      <div className={s.assistantBubble}>
        {thinking && (
          <ThinkingCollapsible
            key={content ? 'with-content' : 'thinking-only'}
            text={thinking}
            t={t}
            Collapsible={Collapsible}
          />
        )}
        {content.length > 0 ? (
          <Markdown text={content} />
        ) : (
          !thinking && <span className={s.thinking}>…</span>
        )}
        {streaming && <span className={s.cursor} aria-hidden="true" />}
        {/* C1:整条复制 —— 复制剥离思考链后的正文 markdown。 */}
        {!streaming && content.length > 0 && <CopyButton text={content} testId="assistant-copy" />}
      </div>
    </div>
  );
}
