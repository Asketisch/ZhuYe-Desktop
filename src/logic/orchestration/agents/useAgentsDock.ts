/**
 * AgentsDock 控制器 —— 右 dock「子代理记录」面板的数据面。
 *
 * 数据源（v1.4 C1 双通道,均来自 agentStore,不直接 invoke）：
 * - 通道一 `subagents.feed`：`subagent_progress` 推送的滚动 feed,
 *   提供子代理的工具调用轨迹（tool_begin / tool_end）与中间消息；
 * - 通道二 `subagents.lastStatus`：`Op::QuerySubagents` 的状态快照
 *   （`subagent_status` 事件,reducer 写入）,提供 role / state /
 *   迭代次数 / 累计 token / 最近事件摘要。
 *
 * 刷新策略：面板挂载（= dock 切到 agents 档）即查一次；会话有在飞
 * turn（`selectIsTurnRunning`）时每 5s 轮询；turn 收尾由 store 的
 * turn 完成钩子补一次快照。其余时刻不自动拉取。
 *
 * 所有解析均防御式：payload 字段缺省 / 类型不符一律回退为空态,
 * 绝不抛错（外部数据源,不信任形状）。
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useAgentStore, selectIsTurnRunning } from '@/stores/agentStore';
import type { SubagentProgressEntry } from '@/stores/agentStore';
import type { SubagentStatusSnapshot } from '@/types/protocol';
import { useActiveSession } from '@/logic/conversation/sessions/useSessions';

/** 运行中会话的子代理快照轮询周期。 */
export const AGENTS_DOCK_POLL_MS = 5000;

/** 记录状态 —— 直接映射 harness CSS 的 `data-st`（run | done | err）。 */
export type AgentsDockSt = 'run' | 'done' | 'err';

/** 子代理工具调用行（展开体里的 `.tool` 行）。 */
export interface AgentsDockTool {
  /** 工具名。 */
  name: string;
  /** tool_end 文本带 `(failed)` 标记 → 失败。 */
  failed: boolean;
  /** 尚未等到配对的 tool_end → 仍在执行。 */
  open: boolean;
  /** begin→end 的耗时（ms）；未配对完成为 null。 */
  durationMs: number | null;
}

/** 单条子代理记录（`.sa` 条目）。 */
export interface AgentsDockRecord {
  /** 子代理会话号（快照 child_id；feed-only 记录用 role+序号兜底）。 */
  childId: string;
  /** 角色（如 `explorer`）。 */
  role: string;
  /** 状态映射：running→run,completed→done,failed/cancelled→err。 */
  st: AgentsDockSt;
  /** 任务摘要：feed 最近一条 message → 快照 last_event → null。 */
  task: string | null;
  /** 最近一条事件摘要（`.sa-out` 正文）。 */
  lastEvent: string | null;
  /** 已完成的图迭代次数。 */
  iteration: number;
  /** 累计 token 用量。 */
  totalTokens: number;
  /** 展示用耗时文本（如 `30s` / `2m05s`）。 */
  durationText: string;
  /** 是否仍在运行。 */
  running: boolean;
  /** 工具调用轨迹（按 feed 顺序）。 */
  tools: AgentsDockTool[];
  /** 子代理中间消息（`.think` 正文,按时间顺序）。 */
  messages: string[];
}

/**
 * `SubagentRunState` → `data-st` 三态映射。
 * `cancelled` 是用户主动中止,非成功终态 → 归入 err（红点）。
 */
function mapState(state: unknown): AgentsDockSt {
  if (state === 'completed') return 'done';
  if (state === 'failed' || state === 'cancelled') return 'err';
  return 'run';
}

/** 毫秒耗时 → 紧凑文本（`42s` / `3m05s` / `1h02m`）；非法值回退 `—`。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

/** RFC3339 → ms；解析失败返回 null。 */
function parseTs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** 防御式取有限非负数。 */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 防御式取字符串（空串归一为 null）。 */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * 从进度 feed 提取某子代理的工具轨迹 + 中间消息（单遍扫描）。
 * feed 不带 call_id（store 投影丢弃）→ 用「同名最近未配对项」配对
 * begin/end,无同名项回退到最近一个未配对项;未配对的 end 忽略。
 * 全部字段缺省安全。
 */
function extractToolsAndMessages(entries: SubagentProgressEntry[], childId: string) {
  const tools: { t: AgentsDockTool; beginAt: number | null }[] = [];
  const messages: string[] = [];
  for (const e of entries) {
    if (!e || e.childId !== childId) continue;
    const text = typeof e.text === 'string' ? e.text : '';
    const at = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : null;
    if (e.kind === 'tool_begin') {
      tools.push({ t: { name: text || 'tool', failed: false, open: true, durationMs: null }, beginAt: at });
    } else if (e.kind === 'tool_end') {
      // 同名最近未配对项优先；没有同名项则关掉最近一个未配对项。
      let target = -1;
      for (let i = tools.length - 1; i >= 0; i -= 1) {
        if (tools[i].t.open && tools[i].t.name === text) { target = i; break; }
      }
      if (target === -1) {
        for (let i = tools.length - 1; i >= 0; i -= 1) {
          if (tools[i].t.open) { target = i; break; }
        }
      }
      if (target >= 0) {
        const { t: tool, beginAt: beginMs } = tools[target];
        tool.open = false;
        tool.failed = text.includes('(failed)');
        if (beginMs !== null && at !== null) {
          tool.durationMs = Math.max(0, at - beginMs);
        }
      }
    } else if (e.kind === 'message' && text) {
      messages.push(text);
    }
  }
  return { tools: tools.map((p) => p.t), messages };
}

/** 解析最近一次快照 → 记录列表；非法输入返回 []（空态）。 */
export function parseAgentsDockRecords(
  lastStatus: unknown,
  feed: SubagentProgressEntry[],
): AgentsDockRecord[] {
  if (!Array.isArray(lastStatus)) return [];
  const now = Date.now();
  const feedEntries = Array.isArray(feed) ? feed : [];
  const records: AgentsDockRecord[] = [];
  lastStatus.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const snap = raw as Partial<SubagentStatusSnapshot> & Record<string, unknown>;
    const childId = str(snap.child_id) ?? '';
    const { tools, messages } = extractToolsAndMessages(feedEntries, childId);
    const startedMs = parseTs(snap.started_at);
    const finishedMs = parseTs(snap.finished_at);
    const running = mapState(snap.state) === 'run';
    const endMs = running || finishedMs === null ? now : finishedMs;
    const durationText =
      startedMs === null ? '—' : formatDuration(Math.max(0, endMs - startedMs));
    records.push({
      childId,
      role: str(snap.role) ?? 'subagent',
      st: mapState(snap.state),
      task: str(snap.last_event) ?? (messages.length > 0 ? messages[messages.length - 1] : null),
      lastEvent: str(snap.last_event),
      iteration: num(snap.iteration),
      totalTokens: num(snap.total_tokens),
      durationText,
      running,
      tools,
      messages,
    });
  });
  return records;
}

export interface AgentsDockData {
  /** 活动会话 id（null = 无活动会话）。 */
  activeId: string | null;
  /** 解析后的记录列表（快照缺失 / 非法时为空数组）。 */
  records: AgentsDockRecord[];
  /** 手动刷新（触发一次 Op::QuerySubagents,应答异步写回 store）。 */
  refresh: () => void;
}

export function useAgentsDock(): AgentsDockData {
  const activeId = useActiveSession().activeId;
  const lastStatus = useAgentStore((st) => st.subagents?.lastStatus);
  const feed = useAgentStore((st) => st.subagents?.feed ?? []);
  const querySubagents = useAgentStore((st) => st.querySubagents);
  const running = useAgentStore(selectIsTurnRunning);

  // querySubagents 只发 Op,应答经 subagent_status 事件异步写回 store。
  const refresh = useCallback(() => {
    void querySubagents().catch(() => {});
  }, [querySubagents]);

  // 挂载（= dock 切到 agents 档）即拉一次快照。
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 会话运行中每 5s 轮询；turn 收尾由 store 的完成钩子补一次。
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(refresh, AGENTS_DOCK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const records = useMemo(() => parseAgentsDockRecords(lastStatus, feed), [lastStatus, feed]);
  return { activeId, records, refresh };
}
