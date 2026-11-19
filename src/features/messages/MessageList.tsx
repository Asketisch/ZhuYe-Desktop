/**
 * MessageList —— 富文本 chat 渲染（CSS Modules 版）。
 *
 * turn.items[] 渲染分发：
 *   - user_text       右对齐用户气泡
 *   - assistant_text  左对齐助手 markdown + streaming 光标
 *   - thinking        可折叠 reasoning
 *   - tool_call + 配对 tool_output（callId）→ 单个 ToolCell（调用与
 *     结果同框；diff 输出默认展开）
 *   - tool_output     孤儿输出（无配对调用,如回放缺 tool_use）→ 独立
 *     可折叠输出框（错误用 danger 主题）
 *   - error           红色错误条
 *
 * 上下文压缩（context_compacted）不进对话流 —— 聚合统计见 Inspector 概览。
 * session 状态行已移到 TitleBar（避免重复）。
 *
 * 按轮 fork：`onForkTurn` 存在时，每个非 streaming turn 尾部 hover 出现
 * 「从此轮分叉」按钮（turn.id 即 rollout 的 turn_id，后端截至该轮复制）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Wrench,
  AlertTriangle,
  MessageSquare,
  FileDiff,
  GitBranch,
  RotateCcw,
  Pencil,
  RefreshCw,
  ChevronsRight,
  Check,
  Copy,
} from 'lucide-react';
import { Icon, IconButton } from '@/features/design-system';
import { Markdown } from '@/components/Markdown';
import { useAgentStore, type Turn, type TurnItem } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { Collapsible } from './Collapsible';
import { ToolCell, ToolOutputBody } from './ToolCells';
import { QueuedMessages } from './QueuedMessages';
import { UserAttachments } from './UserAttachments';
import { splitAssistantText } from './assistantText';
import s from './MessageList.module.css';

const NEAR_BOTTOM_PX = 64;

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>;
type ToolOutputItem = Extract<TurnItem, { kind: 'tool_output' }>;

/** 渲染节点：普通 item 直渲染;tool 节点把 callId 配对的调用+输出合为一框。 */
type RenderNode =
  | { kind: 'item'; item: TurnItem }
  | { kind: 'tool'; call: ToolCallItem; output?: ToolOutputItem };

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
  return nodes;
}

export function MessageList({
  onForkTurn,
  onRewindTurn,
  onEditTurn,
  onRegenerateTurn,
  onContinueTurn,
}: {
  /** 可选：按轮 fork —— 传入后在每个已结束 turn 上提供「从此轮分叉」入口。 */
  onForkTurn?: (turnId: string, branch: string) => void;
  /** 可选：按轮回退 —— 传入后在每个已结束 turn 上提供「回退到此轮之前」入口。 */
  onRewindTurn?: (turnId: string) => void;
  /** 可选：按轮编辑(v1.11 F7+D6)—— 截断后把该轮用户文本填回 composer。 */
  onEditTurn?: (turnId: string) => void;
  /** 可选：一键重生成(C2)—— rewind 到该轮用户消息前 + 原样重发。 */
  onRegenerateTurn?: (turnId: string) => void;
  /** 可选：继续生成(C3)—— 仅末轮提供,提交续写指令(引擎无 Continue Op)。 */
  onContinueTurn?: (turnId: string) => void;
} = {}) {
  const turns = useAgentStore((st) => st.turns);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < NEAR_BOTTOM_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

  return (
    <div className={s.scroll} ref={ref} role="log" aria-label={t('chat.ariaLabel')} aria-live="polite" aria-atomic="false">
      <div className={s.inner}>
        {turns.length === 0 && (
          <div className={s.emptyWrap}>
            <Icon icon={MessageSquare} size={32} className={s.emptyIcon} />
            <p className={s.emptyTitle}>{t('chat.empty.title')}</p>
            <p className={s.emptyHint}>{t('chat.empty.hint')}</p>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnView
            key={t.id}
            turn={t}
            index={i}
            isLast={i === turns.length - 1}
            onForkTurn={onForkTurn}
            onRewindTurn={onRewindTurn}
          onEditTurn={onEditTurn}
          onRegenerateTurn={onRegenerateTurn}
          onContinueTurn={onContinueTurn}
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
}: {
  turn: Turn;
  index: number;
  isLast?: boolean;
  onForkTurn?: (turnId: string, branch: string) => void;
  onRewindTurn?: (turnId: string) => void;
  onEditTurn?: (turnId: string) => void;
  onRegenerateTurn?: (turnId: string) => void;
  onContinueTurn?: (turnId: string) => void;
}) {
  const nodes = groupToolNodes(turn.items);
  const { t } = useI18n();
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
          key={`${i}-${node.kind === 'tool' && node.output?.diff ? 'diff' : 'flat'}`}
          node={node}
          turnStatus={turn.status}
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

function ItemView({ node, turnStatus }: { node: RenderNode; turnStatus: Turn['status'] }) {
  const { t } = useI18n();

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
      return <UserBubble text={item.text} />;

    case 'user_attachments':
      return <UserAttachments attachments={item.attachments} />;

    case 'assistant_text': {
      const streaming = item.streaming === true && turnStatus === 'streaming';
      return <AssistantBubble text={item.text} streaming={streaming} />;
    }

    case 'thinking':
      // F50:summary(推理摘要)与 raw(流式思考)区分渲染 —— 语义不同,
      // 摘要带专属标签(与引擎 ThinkingDeltaKind::Summary →
      // ReasoningSummary 的路由语义一致)。
      return item.variant === 'summary' ? (
        <ThinkingCollapsible text={item.text} summaryLabel />
      ) : (
        <ThinkingCollapsible text={item.text} />
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
function CopyButton({ text, testId }: { text: string; testId: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      className={s.copyBtn}
      onClick={onCopy}
      title={t('chat.copyMessage')}
      aria-label={t('chat.copyMessage')}
      data-testid={testId}
    >
      <Icon icon={copied ? Check : Copy} size={12} />
    </button>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className={s.userRow}>
      <div className={s.userBubble}>{text}</div>
      <CopyButton text={text} testId="user-copy" />
    </div>
  );
}

/** 思考过程折叠块（ThinkingDelta 事件与正文 <think> 分段共用）。
 *  文字用弱化色 —— 思考与正式输出视觉分级。 */
function ThinkingCollapsible({
  text,
  defaultOpen = false,
  summaryLabel = false,
}: {
  text: string;
  defaultOpen?: boolean;
  summaryLabel?: boolean;
}) {
  const { t } = useI18n();
  const snippet = text.slice(0, 60).replace(/\s+/g, ' ');
  const label = summaryLabel
    ? t('chat.thinkingSummary')
    : text.length > 60
      ? t('chat.thinkingWith', { snippet })
      : t('chat.thinking');
  return (
    <Collapsible
      icon={<Icon icon={Brain} size={13} />}
      accent={summaryLabel ? 'success' : 'info'}
      defaultOpen={defaultOpen}
      label={label}
    >
      <pre className={`${s.monoText} ${s.thinkingText}`}>{text}</pre>
    </Collapsible>
  );
}

function AssistantBubble({ text, streaming }: { text: string; streaming: boolean }) {
  // 模型把推理以 <think> 标签混进正文、runtime 的 nudge 提醒会让模型
  // 回显 FINAL ANSWER 标记 —— 都不属于正文,渲染前分段/剥离。
  const { thinking, content } = splitAssistantText(text);
  return (
    <div className={s.assistantRow}>
      <div className={s.assistantAvatar} aria-hidden="true">R</div>
      <div className={s.assistantBubble}>
        {thinking && (
          <ThinkingCollapsible
            // 正文出现后重挂载让折叠块自动收起(默认展开仅在纯思考阶段)。
            key={content ? 'with-content' : 'thinking-only'}
            text={thinking}
            defaultOpen={streaming && !content}
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
