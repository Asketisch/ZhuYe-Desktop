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
import { useEffect, useRef } from 'react';
import {
  Brain,
  Wrench,
  AlertTriangle,
  MessageSquare,
  FileDiff,
  GitBranch,
  RotateCcw,
} from 'lucide-react';
import { Icon, IconButton } from '@/features/design-system';
import { Markdown } from '@/components/Markdown';
import { useAgentStore, type Turn, type TurnItem } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { Collapsible } from './Collapsible';
import { ToolCell, ToolOutputBody } from './ToolCells';
import { QueuedMessages } from './QueuedMessages';
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
}: {
  /** 可选：按轮 fork —— 传入后在每个已结束 turn 上提供「从此轮分叉」入口。 */
  onForkTurn?: (turnId: string, branch: string) => void;
  /** 可选：按轮回退 —— 传入后在每个已结束 turn 上提供「回退到此轮之前」入口。 */
  onRewindTurn?: (turnId: string) => void;
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
            onForkTurn={onForkTurn}
            onRewindTurn={onRewindTurn}
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
  onForkTurn,
  onRewindTurn,
}: {
  turn: Turn;
  index: number;
  onForkTurn?: (turnId: string, branch: string) => void;
  onRewindTurn?: (turnId: string) => void;
}) {
  const nodes = groupToolNodes(turn.items);
  const { t } = useI18n();
  // 流式中的 turn 尚未落全（rollout 记录还在追加），不作为 fork 点；
  // 历史回放与已结束的 turn 均可「从此轮（含）分叉」。
  const canFork = Boolean(onForkTurn) && turn.status !== 'streaming';
  // rewind 丢弃「此轮(含)之后」的对话记录(引擎 Op::Rewind),同样只对
  // 已落全的 turn 开放;与 fork 并列在 hover 动作行。
  const canRewind = Boolean(onRewindTurn) && turn.status !== 'streaming';
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
      {(canFork || canRewind) && (
        <div className={s.turnActions}>
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

    case 'assistant_text': {
      const streaming = item.streaming === true && turnStatus === 'streaming';
      return <AssistantBubble text={item.text} streaming={streaming} />;
    }

    case 'thinking':
      return <ThinkingCollapsible text={item.text} />;

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

function UserBubble({ text }: { text: string }) {
  return (
    <div className={s.userRow}>
      <div className={s.userBubble}>{text}</div>
    </div>
  );
}

/** 思考过程折叠块（ThinkingDelta 事件与正文 <think> 分段共用）。
 *  文字用弱化色 —— 思考与正式输出视觉分级。 */
function ThinkingCollapsible({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const snippet = text.slice(0, 60).replace(/\s+/g, ' ');
  return (
    <Collapsible
      icon={<Icon icon={Brain} size={13} />}
      accent="info"
      defaultOpen={defaultOpen}
      label={text.length > 60 ? t('chat.thinkingWith', { snippet }) : t('chat.thinking')}
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
      </div>
    </div>
  );
}
