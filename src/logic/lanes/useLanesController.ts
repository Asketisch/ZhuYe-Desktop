/**
 * 泳道控制器 —— harness 单色版「子代理并行执行」页的编排 hook。
 *
 * 两个数据源归一成 `LaneRow` 投影:
 *   - 引擎子代理快照:store 的 `subagents.lastStatus`(`Op::QuerySubagents`
 *     的 `subagent_status` 事件应答,reducer 落 store)—— 挂载拉一次,
 *     会话 turn 在飞时每 5s 轮询;
 *   - side-channel:`reflect_list_side_channels` 查询,运行中同样 5s
 *     轮询,生命周期事件到达即失效缓存。
 *
 * 「中止全部」对运行中的 side-channel 走 `reflect_cancel_side_channel`,
 * 对运行中的引擎子代理走 store 的 `interruptSubagent`(`Op::Interrupt`
 * 的 child 形态)—— 两类在飞代理一起停。
 *
 * 「派生子代理」按钮刻意缺省:安全派生需要 agent 名 + prompt 输入面
 * (`reflect_start_side_channel` 必须携带两者),泳道页没有表单承载,
 * 不做假按钮 —— 派生入口由 SideChannelView(/side-channels)承担。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reflect_list_side_channels,
  reflect_cancel_side_channel,
  type ReflectSideChannelInfo,
} from '@/utils/commands';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { useAgentStore } from '@/stores/agentStore';
import { selectIsTurnRunning } from '@/stores/agent/selectors';
import { useI18n } from '@/utils/i18n';
import type { LaneRow, LaneStep, LaneTone } from '@/contracts/lanes';

/** side-channel 查询键(中止后精确失效)。 */
export const LANES_SIDECHANNELS_KEY = ['lanes', 'side-channels'] as const;

/** 轮询周期(与 side-channel 面板的 5s 快照节奏一致)。 */
const POLL_MS = 5_000;

/** 会话短 id 截断长度。 */
const SESSION_SHORT_LEN = 8;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'msg' in e) return String((e as { msg: unknown }).msg);
  return String(e);
}

/** 引擎子代理状态 → 泳道基调。 */
function childTone(state: string): LaneTone {
  if (state === 'running') return 'run';
  if (state === 'completed') return 'ok';
  if (state === 'failed') return 'err';
  return 'done'; // cancelled 视作中性收尾
}

/** side-channel 状态 → 泳道基调。 */
function channelTone(status: ReflectSideChannelInfo['status']): LaneTone {
  if (status === 'running') return 'run';
  if (status === 'done') return 'ok';
  if (status === 'error') return 'err';
  return 'done';
}

export interface UseLanesControllerResult {
  sessionLabel: string | null;
  lanes: LaneRow[];
  runningCount: number;
  doneCount: number;
  failedCount: number;
  hasRunning: boolean;
  busy: boolean;
  refresh: () => void;
  cancelAll: () => Promise<void>;
}

export function useLanesController(): UseLanesControllerResult {
  const qc = useQueryClient();
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);

  const isTurnRunning = useAgentStore(selectIsTurnRunning);
  const loadedSessionId = useAgentStore((st) => st.loadedSessionId);
  const lastStatus = useAgentStore((st) => st.subagents.lastStatus);
  const querySubagents = useAgentStore((st) => st.querySubagents);
  const interruptSubagent = useAgentStore((st) => st.interruptSubagent);

  const [busy, setBusy] = useState(false);

  // ── side-channel 查询:会话在飞时 5s 轮询,否则挂载拉一次 ──
  const channelsQ = useQuery({
    queryKey: [...LANES_SIDECHANNELS_KEY],
    queryFn: reflect_list_side_channels,
    refetchInterval: isTurnRunning ? POLL_MS : false,
  });
  const channels = useMemo(
    () => (Array.isArray(channelsQ.data) ? channelsQ.data : []),
    [channelsQ.data],
  );

  // 挂载即拉一次子代理快照(应答经 subagent_status 事件落 store)。
  useEffect(() => {
    void querySubagents().catch(() => {});
  }, [querySubagents]);

  // turn 在飞时每 5s 轮询子代理快照。
  useEffect(() => {
    if (!isTurnRunning) return;
    const timer = window.setInterval(() => {
      void querySubagents().catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isTurnRunning, querySubagents]);

  // side-channel 生命周期事件到达即失效查询(不等轮询);子代理快照
  // (subagent_status)由 store 订阅自动落 `lastStatus`,无需再失效。
  useEffect(
    () =>
      subscribeAgentEvent((event) => {
        const type = event.msg?.type;
        if (
          type === 'side_channel_started' ||
          type === 'side_channel_finished' ||
          type === 'side_channel_status'
        ) {
          void qc.invalidateQueries({ queryKey: [...LANES_SIDECHANNELS_KEY] });
        }
      }),
    [qc],
  );

  // ── 归一泳道 ──
  const lanes = useMemo<LaneRow[]>(() => {
    const rows: LaneRow[] = [];
    const now = Date.now();

    // 1) 引擎子代理快照(payload 无步骤历史 → 单 chip 投影当前活动)。
    for (const child of Array.isArray(lastStatus) ? lastStatus : []) {
      if (!child || typeof child !== 'object' || !child.child_id) continue;
      const running = child.state === 'running';
      const startMs = Date.parse(String(child.started_at ?? ''));
      const endMs = child.finished_at ? Date.parse(String(child.finished_at)) : NaN;
      const durationSec = Number.isFinite(startMs)
        ? Math.max(0, ((Number.isFinite(endMs) ? endMs : now) - startMs) / 1000)
        : null;
      const steps: LaneStep[] = running
        ? [{ label: child.current_tool || t('harness.lanes.active'), tone: 'run' }]
        : child.state === 'failed'
          ? [{ label: child.current_tool || t('harness.lanes.failed'), tone: 'err' }]
          : [{ label: t(child.state === 'cancelled' ? 'harness.lanes.cancelled' : 'harness.lanes.done'), tone: 'done' }];
      rows.push({
        id: `child:${child.child_id}`,
        name: child.role || child.child_id,
        task: child.last_event || child.current_tool || '',
        tone: childTone(String(child.state)),
        running,
        steps,
        tokens: typeof child.total_tokens === 'number' ? child.total_tokens : null,
        durationSec,
        percent: null,
      });
    }

    // 2) side-channel(prompt 即任务;运行中按时长推进)。
    for (const channel of channels) {
      if (!channel || !channel.id) continue;
      const running = channel.status === 'running';
      const durationSec =
        channel.durationMs != null
          ? channel.durationMs / 1000
          : running && channel.startedAtMs > 0
            ? Math.max(0, (now - channel.startedAtMs) / 1000)
            : null;
      const steps: LaneStep[] = [
        {
          label: running
            ? t('harness.lanes.active')
            : t(
                channel.status === 'done'
                  ? 'harness.lanes.done'
                  : channel.status === 'error'
                    ? 'harness.lanes.failed'
                    : 'harness.lanes.cancelled',
              ),
          tone: channel.status === 'error' ? 'err' : running ? 'run' : 'done',
        },
      ];
      rows.push({
        id: `side:${channel.id}`,
        name: channel.agentName || channel.id,
        task: channel.prompt || '',
        tone: channelTone(channel.status),
        running,
        steps,
        tokens: null,
        durationSec,
        percent: null,
      });
    }

    return rows;
  }, [lastStatus, channels, t]);

  const runningCount = useMemo(() => lanes.filter((l) => l.running).length, [lanes]);
  const doneCount = useMemo(() => lanes.filter((l) => l.tone === 'ok' || l.tone === 'done').length, [lanes]);
  const failedCount = useMemo(() => lanes.filter((l) => l.tone === 'err').length, [lanes]);

  const refresh = useCallback(() => {
    void querySubagents().catch(() => {});
    void qc.invalidateQueries({ queryKey: [...LANES_SIDECHANNELS_KEY] });
  }, [qc, querySubagents]);

  /** 中止全部:side-channel 逐条 cancel + 引擎子代理逐个 interrupt。 */
  const cancelAll = useCallback(async () => {
    setBusy(true);
    try {
      const cancelTargets = channels.filter((c) => c.status === 'running');
      const interruptTargets = (Array.isArray(lastStatus) ? lastStatus : []).filter(
        (c) => c && c.state === 'running' && c.child_id,
      );
      const results = await Promise.allSettled([
        ...cancelTargets.map((c) => reflect_cancel_side_channel(c.id)),
        ...interruptTargets.map((c) => interruptSubagent(c.child_id)),
      ]);
      void qc.invalidateQueries({ queryKey: [...LANES_SIDECHANNELS_KEY] });
      void querySubagents().catch(() => {});
      const rejected = results.find((r) => r.status === 'rejected');
      if (results.length === 0) {
        pushToast({ kind: 'info', message: t('harness.lanes.noneRunning') });
      } else if (rejected) {
        pushToast({ kind: 'warn', message: t('harness.lanes.toastCancelPartial', { message: errorMessage((rejected as PromiseRejectedResult).reason) }) });
      } else {
        pushToast({ kind: 'success', message: t('harness.lanes.toastCancelled') });
      }
    } finally {
      setBusy(false);
    }
  }, [channels, interruptSubagent, lastStatus, pushToast, qc, querySubagents, t]);

  return {
    sessionLabel: loadedSessionId
      ? loadedSessionId.slice(0, SESSION_SHORT_LEN)
      : null,
    lanes,
    runningCount,
    doneCount,
    failedCount,
    hasRunning: runningCount > 0,
    busy,
    refresh,
    cancelAll,
  };
}
