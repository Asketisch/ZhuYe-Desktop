import { Wrench, AlertTriangle, MessageSquare, FileDiff, GitBranch, RotateCcw, Pencil, RefreshCw, ChevronsRight } from 'lucide-react';
import type { MessageListSlots, MessageListViewProps, Turn, TurnItem } from '@/contracts/conversation/messageList';
import { Icon } from '@/render/harness/design-system/Icon';
import { IconButton } from '@/render/harness/design-system/IconButton';
import { groupToolNodes, isSubagentFollowUp, type RenderNode } from './activityGrouping';
import s from './MessageList.module.css';

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
  const { TurnChangesCard } = slots;
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
          turn={turn}
          turnStatus={turn.status}
          t={t}
          slots={slots}
        />
      ))}
      {/* v1.13:本轮改动卡 —— 挂在该轮内容之后、轮操作行之前。
          改动是逐轮产生的,跟着轮次走才读得懂「这一轮改了什么」
          （对齐 ZCode v4 的 ConversationFileSummaryPanel 位置约定）。 */}
      <TurnChangesCard turn={turn} />
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

function ItemView({ node, turn, turnStatus, t, slots }: { node: RenderNode; turn: Turn; turnStatus: Turn['status']; t: MessageListViewProps['t']; slots: MessageListSlots }) {
  const { ToolCell, ToolOutputBody, UserAttachments, Collapsible, ToolGroup, ActivityGroup, ThinkingCollapsible } = slots;

  // 思考条目是否仍在流式生成:turn 还在 streaming 且该条目就是轮内末条
  // （thinking_delta 一直追加到末条;一旦工具/正文落位即不再是末条）。
  // `<think>` 拆段合成的条目不是 store 对象,恒判为已结束。
  const isThinkingStreaming = (item: TurnItem) =>
    turnStatus === 'streaming' && turn.items[turn.items.length - 1] === item;

  if (node.kind === 'activityGroup') {
    // 工具 + 思考混合段：思考不打断工具流,同组折叠（对话式 agent 产品惯例）。
    const entryMeta = node.entries.map((entry) =>
      entry.kind === 'thinking'
        ? { thinking: true }
        : { toolName: entry.call.toolName, argsSummary: entry.call.argsSummary || entry.call.argsStream, status: entry.call.status },
    );
    return (
      <ActivityGroup entries={entryMeta}>
        {node.entries.map((entry, i) =>
          entry.kind === 'thinking' ? (
            // key 不再掺 text.length —— 思考块升级为有状态组件（时长摘要 +
            // 吸底滚动），文本每增一点就重挂会把展开态/滚动位置打回原点。
            <ThinkingCollapsible
              key={`th-${i}`}
              text={entry.item.text}
              streaming={isThinkingStreaming(entry.item)}
              startedAt={entry.item.startedAt}
              endedAt={entry.item.endedAt}
              summaryLabel={entry.item.variant === 'summary'}
              compact
            />
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
      <ToolGroup toolNames={names} count={node.entries.length} defaultOpen={hasDiff} hasFollowUp={node.entries.some((entry) => isSubagentFollowUp(entry.call))}>
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
      return <AssistantBubble text={item.text} streaming={streaming} slots={slots} />;
    }

    case 'thinking':
      // F50:summary(推理摘要)与 raw(流式思考)区分渲染 —— 语义不同,
      // 摘要带专属标签(与引擎 ThinkingDeltaKind::Summary →
      // ReasoningSummary 的路由语义一致)。
      return (
        <ThinkingCollapsible
          text={item.text}
          streaming={isThinkingStreaming(item)}
          startedAt={item.startedAt}
          endedAt={item.endedAt}
          summaryLabel={item.variant === 'summary'}
        />
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

/** 思考过程折叠块已升级为有状态切片组件 `features/conversation/messages/
 *  ThinkingCollapsible.tsx`（时长摘要 + 流式吸底滚动，经 slots 注入）——
 *  render 层保持纯展示，不在此地持有展开态与滚动编排。 */

function AssistantBubble({ text, streaming, slots }: { text: string; streaming: boolean; slots: MessageListSlots }) {
  const { Markdown, CopyButton } = slots;
  // `<think>` 思考段已在活动聚合层（activityGrouping）拆出并并入工具
  // 折叠组 —— 本气泡只渲染剥离思考后的正文。
  return (
    <div className={s.assistantRow}>
      <div className={s.assistantAvatar} aria-hidden="true">R</div>
      <div className={s.assistantBubble}>
        <Markdown text={text} />
        {/* C1:整条复制 —— 复制剥离思考链后的正文 markdown。 */}
        {!streaming && text.length > 0 && <CopyButton text={text} testId="assistant-copy" />}
      </div>
    </div>
  );
}
