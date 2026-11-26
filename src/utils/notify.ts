/**
 * useAgentNotifications —— agent 事件 → 声音 / 系统通知 / dock badge。
 *
 * 通知门控(三层:失焦 / 时长 / 节流):
 *   - 失焦门控:窗口聚焦时不弹系统通知(避免「人就在屏幕前」被打扰);
 *   - 时长门控:turn 运行不足 `minDurationMs` 不通知(秒回无需召回);
 *   - 节流:同一 turn 1.5s 内只发一条;
 *   - 通知正文 = agent 最后一条回复(截断 200 字符),点击跳回对应会话;
 *   - 「需要你处理」通知:等待审批/提问/输入/plan 时单独召回;
 *   - dock badge:待处理交互数(macOS,后端 no-op 兜底其他平台)。
 *
 * 复用 agent event 总线(`subscribeAgentEvent`);选项持久化 localStorage。
 */
import { useEffect, useRef } from 'react';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { useAgentStore } from '@/stores/agentStore';
import { zhuye_set_dock_badge } from '@/utils/commands/telemetry/notifications';

export interface AgentNotifyOptions {
  /** 是否启用声音(默认 true 直到用户在 Settings 里关闭)。 */
  sound: boolean;
  /** 是否弹系统通知(默认 false,需要 OS 权限)。 */
  system: boolean;
  /** 音量(0..1)。默认 0.4。 */
  volume?: number;
  /** 仅窗口失焦时弹系统通知(默认 true)。 */
  onlyUnfocused?: boolean;
  /** turn 运行低于该毫秒数不通知(默认 60000;0 = 关闭时长门控)。 */
  minDurationMs?: number;
  /** 等待审批/提问/输入/plan 时发「需要你处理」通知(默认 true)。 */
  notifyApproval?: boolean;
  /** dock badge 显示待处理交互数(默认 false)。 */
  dockBadge?: boolean;
}

const KEY = 'zhuye.notify.options';
const DEFAULTS: Required<AgentNotifyOptions> = {
  sound: false,
  system: false,
  volume: 0.4,
  onlyUnfocused: true,
  minDurationMs: 60_000,
  notifyApproval: true,
  dockBadge: false,
};

const DEFAULT_MIN_DURATION_MS = 60_000;
/** 同一 turn 的通知节流窗口。 */
const THROTTLE_MS = 1_500;
/** 通知正文最大长度。 */
export const MAX_BODY_LENGTH = 200;

export function loadNotifyOptions(): AgentNotifyOptions {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveNotifyOptions(opts: AgentNotifyOptions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {
    /* ignore */
  }
}

// ── 纯门控逻辑(可独立测试) ──────────────────────────────────────────────

export interface NotifyGateInput {
  focused: boolean;
  /** turn 运行时长;null = 没有记录到 turn 开始(不通知)。 */
  durationMs: number | null;
  lastNotifiedAt: number | undefined;
  now: number;
}

/** turn 完成是否应弹系统通知(门控:开关 → 时长 → 失焦 → 节流)。 */
export function shouldNotifyTurnComplete(
  input: NotifyGateInput,
  opts: Pick<AgentNotifyOptions, 'system' | 'onlyUnfocused' | 'minDurationMs'>,
): boolean {
  if (!opts.system) return false;
  if (input.durationMs === null) return false;
  const min = opts.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
  if (min > 0 && input.durationMs < min) return false;
  if ((opts.onlyUnfocused ?? true) && input.focused) return false;
  if (input.lastNotifiedAt !== undefined && input.now - input.lastNotifiedAt < THROTTLE_MS) {
    return false;
  }
  return true;
}

/** 通知正文截断(200 字符 + 省略号)。 */
export function truncateBody(text: string, maxLength = MAX_BODY_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface AgentNotificationHooks {
  /** 点击通知时导航到触发通知的会话(AppShell 传入路由回调)。 */
  onOpenSession?: (sessionId: string) => void;
  /** 当前激活会话 id(通知点击的跳转目标)。 */
  sessionId?: string | null;
  /** 通知标题(默认 "ZhuYe")。 */
  title?: string;
  /** 「需要你处理」通知正文(i18n 由调用方注入)。 */
  approvalBody?: string;
  /** 无最后回复时的完成通知正文(i18n 由调用方注入)。 */
  turnFinishedBody?: string;
}

/**
 * Hook:订阅 agent event 总线 + 待处理交互状态,按选项触发声音 /
 * 系统通知 / dock badge。首次播放需要用户手势解锁 AudioContext。
 */
export function useAgentNotifications(
  options: AgentNotifyOptions,
  hooks: AgentNotificationHooks = {},
): void {
  const audioRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const playingRef = useRef(false);

  // turn 生命周期跟踪(时长门控 + 正文取最后回复)。
  const turnStartRef = useRef(new Map<string, number>());
  const lastMessageRef = useRef(new Map<string, string>());
  const lastNotifiedRef = useRef(new Map<string, number>());
  const focusedRef = useRef(
    typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : true,
  );
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  // 解锁 audio (autoplay policy)。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      if (unlockedRef.current) return;
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) audioRef.current = new Ctor();
      } catch {
        /* ignore */
      }
      unlockedRef.current = true;
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // 窗口聚焦跟踪(失焦门控)。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFocus = () => {
      focusedRef.current = true;
    };
    const onBlur = () => {
      focusedRef.current = false;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // dock badge:待处理交互数变化时推给后端(非 macOS 后端 no-op)。
  const pendingTotal = useAgentStore((st) =>
    st.pendingApprovals.length +
    st.pendingQuestions.length +
    st.pendingAskUser.length +
    (st.pendingPlan ? 1 : 0),
  );
  useEffect(() => {
    if (!options.dockBadge) return;
    void zhuye_set_dock_badge(pendingTotal > 0 ? String(pendingTotal) : null).catch(() => {
      /* 后端不可达时静默 */
    });
    return () => {
      if (pendingTotal > 0) void zhuye_set_dock_badge(null).catch(() => {});
    };
  }, [options.dockBadge, pendingTotal]);

  // 「需要你处理」通知:待处理交互从无到有时,失焦则召回。
  const prevPendingRef = useRef(pendingTotal);
  useEffect(() => {
    const had = prevPendingRef.current;
    prevPendingRef.current = pendingTotal;
    if (!options.system || !options.notifyApproval) return;
    if (pendingTotal <= had || pendingTotal === 0) return;
    if ((options.onlyUnfocused ?? true) && focusedRef.current) return;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(hooksRef.current.title ?? 'ZhuYe', {
          body: truncateBody(
            hooksRef.current.approvalBody ??
              'ZhuYe needs your attention (approval / question pending).',
          ),
        });
        notification.onclick = () => {
          window.focus();
          hooksRef.current.onOpenSession?.(hooksRef.current.sessionId ?? '');
        };
      }
    } catch {
      /* ignore */
    }
  }, [options.system, options.notifyApproval, options.onlyUnfocused, pendingTotal]);

  useEffect(() => {
    return subscribeAgentEvent((event) => {
      const t = event.msg.type;
      const turnId = event.id;

      // 记录 turn 开始(时长门控的起点)。
      if (t === 'turn_started' && turnId) {
        turnStartRef.current.set(turnId, Date.now());
        lastMessageRef.current.delete(turnId);
      }

      // 记录最后一条 agent 回复(通知正文)。
      if (t === 'agent_message' && turnId) {
        lastMessageRef.current.set(turnId, event.msg.text);
      }

      // 声音:agent 回复出现即播(保持既有行为,不受失焦门控)。
      if (t === 'agent_message' && options.sound) {
        if (playingRef.current) return;
        playingRef.current = true;
        try {
          playChime(audioRef.current, options.volume ?? 0.4);
        } finally {
          window.setTimeout(() => {
            playingRef.current = false;
          }, 600);
        }
      }

      // 系统通知(turn 完成,门控后)。
      if (t === 'turn_complete' && options.system) {
        const startedAt = turnStartRef.current.get(turnId);
        const durationMs = startedAt === undefined ? null : Date.now() - startedAt;
        const lastNotifiedAt = lastNotifiedRef.current.get(turnId);
        const gated = shouldNotifyTurnComplete(
          { focused: focusedRef.current, durationMs, lastNotifiedAt, now: Date.now() },
          options,
        );
        if (gated) {
          lastNotifiedRef.current.set(turnId, Date.now());
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const body =
                lastMessageRef.current.get(turnId) ??
                hooksRef.current.turnFinishedBody ??
                'Turn finished.';
              const notification = new Notification(hooksRef.current.title ?? 'ZhuYe', {
                body: truncateBody(body),
              });
              notification.onclick = () => {
                window.focus();
                hooksRef.current.onOpenSession?.(hooksRef.current.sessionId ?? '');
              };
            }
          } catch {
            /* ignore */
          }
        }
      }

      // turn 终止(完成/中止)统一清理 per-turn 跟踪条目 —— 与门控、
      // system 开关无关。此前被门控拒绝或 turn_aborted 的条目永不清理,
      // 每条泄漏一条完整回复文本。
      if (t === 'turn_complete' || t === 'turn_aborted') {
        turnStartRef.current.delete(turnId);
        lastMessageRef.current.delete(turnId);
        lastNotifiedRef.current.delete(turnId);
      }
    });
  }, [options.sound, options.system, options.volume, options.onlyUnfocused, options.minDurationMs]);
}

/** 简单 chime:两个短促正弦波(c5 → e5)。 */
function playChime(ctx: AudioContext | null, volume: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const tones = [
    { freq: 523.25, start: 0, dur: 0.18 },
    { freq: 659.25, start: 0.2, dur: 0.22 },
  ];
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = tone.freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, now + tone.start);
    gain.gain.linearRampToValueAtTime(volume, now + tone.start + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + tone.start + tone.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + tone.start);
    osc.stop(now + tone.start + tone.dur + 0.02);
  }
}

/** 请求原生通知权限。由浏览器 / Tauri WebView 自行决定。 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
