/**
 * Coding plan 额度耗尽自动切换（跨供应商 failover）。
 *
 * 分层职责：
 *  - 同 provider 池内凭证切换（429/401/5xx 冷却 + failover）由上游
 *    zhuye-core graph 层完成，GUI 无需介入；
 *  - **跨 provider** 的计划切换（`[active].provider` → 备用计划）没有
 *    上编排，由本模块在前端补齐：监听 `quota_exhausted` / `error` 事件,
 *    判定耗尽 → 挑选备用 provider → `zhuye_save_config` 落盘 →
 *    后端热重载新 provider 栈（`state/reload.rs`）→ toast 告知用户。
 *
 * 依赖注入（getConfig/saveConfig/pushToast）使控制器可脱离 zustand
 * 与 Tauri IPC 单测。
 */

import { pickFailoverProvider, setActiveProvider } from '@/logic/settings/config/plans';
import { zhuye_get_config, zhuye_save_config } from '@/utils/commands';
import type { ToastKind } from './types';

/** 额度耗尽的文本特征（小写匹配）。涵盖上游 ALL_CREDENTIALS_EXHAUSTED、
 * 各家订阅计划的 usage limit / quota / 余额类报错。AUTH(401) 不在此列 ——
 * key 无效不是"耗尽"，自动切换会掩盖配置错误。 */
const EXHAUSTION_PATTERNS = [
  'all_credentials_exhausted',
  'usage limit',
  'usagelimit',
  'quota',
  'insufficient',
  'balance',
  '额度',
  '余额',
  '配额',
];

/** 两次自动切换之间的防抖窗口：切换后给新计划至少 60s 观察/重试时间。 */
export const FAILOVER_DEBOUNCE_MS = 60_000;

/** UI 偏好键（localStorage）：'off' = 关闭自动切换；缺省开启。 */
export const AUTO_FAILOVER_PREF_KEY = 'zhuye.plans.autoFailover';

export function isAutoFailoverEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_FAILOVER_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export interface PlanExhaustionSignal {
  /** 耗尽的 provider（事件未指明时回退当前会话 provider，可能为 ''）。 */
  provider: string;
  /** 事件给的 credential label（quota_exhausted 才有）。 */
  label?: string;
  /** 人类可读原因（toast 文案）。 */
  reason: string;
}

interface ExhaustedMsgLike {
  type: string;
  provider?: string;
  label?: string;
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * 从事件中提取"额度耗尽"信号；非耗尽事件返回 null。
 *
 * - `quota_exhausted`：上游 QuotaTracker 的明确信号，直接采信。
 * - `error`：code + message + details JSON 命中耗尽特征才判定
 *   （上游给池内凭证全部冷却后以 `ALL_CREDENTIALS_EXHAUSTED` 终止）。
 */
export function extractExhaustionSignal(
  msg: ExhaustedMsgLike,
  currentProvider: string | null,
): PlanExhaustionSignal | null {
  if (msg.type === 'quota_exhausted') {
    return {
      provider: msg.provider ?? currentProvider ?? '',
      label: msg.label ?? undefined,
      reason: msg.message ?? '配额窗口耗尽',
    };
  }
  if (msg.type !== 'error') return null;
  // stringify 包 try/catch —— 上游 details 可能含循环引用,在同步链路里抛出会
  // 中断整个 reducer subscriber,丢掉后续事件。
  const detailsText = (() => {
    if (msg.details == null) return '';
    if (typeof msg.details === 'string') return msg.details;
    try {
      return JSON.stringify(msg.details);
    } catch {
      return '';
    }
  })();
  const haystack = [msg.code ?? '', msg.message ?? '', detailsText]
    .join(' ')
    .toLowerCase();
  if (!EXHAUSTION_PATTERNS.some((p) => haystack.includes(p))) return null;
  return {
    provider: (readDetailsProvider(msg.details) ?? currentProvider ?? ''),
    reason: msg.message ?? msg.code ?? '额度耗尽',
  };
}

function readDetailsProvider(details: unknown): string | null {
  if (details == null || typeof details !== 'object') return null;
  const provider = (details as Record<string, unknown>).provider;
  return typeof provider === 'string' ? provider : null;
}

export interface PlanFailoverDeps {
  /** 读取当前 config TOML（zhuye_get_config）。 */
  getConfig: () => Promise<string>;
  /** 写回 config（zhuye_save_config；后端随即热重载 provider 栈）。 */
  saveConfig: (toml: string) => Promise<unknown>;
  pushToast: (input: { kind: ToastKind; message: string; ttlMs?: number }) => unknown;
  /** 自动切换开关（UI 偏好，默认开）。 */
  isEnabled: () => boolean;
  /** 切换成功回调（store 记录 planFailover 状态供状态栏展示）。 */
  onSwitched: (from: string, to: string) => void;
  /** 当前会话 provider（事件未指明时兜底）。 */
  currentProvider: () => string | null;
}

export interface PlanFailoverController {
  /** 处理一次耗尽信号（内部做防抖 + 开关检查；异步不阻塞事件循环）。 */
  handle: (signal: PlanExhaustionSignal) => Promise<void>;
  /** 切会话 / reset 时清空防抖状态。 */
  reset: () => void;
}

export function createPlanFailoverController(deps: PlanFailoverDeps): PlanFailoverController {
  let lastFailoverAt = 0;

  return {
    reset: () => {
      lastFailoverAt = 0;
    },
    handle: async (signal: PlanExhaustionSignal) => {
      if (!deps.isEnabled()) return;
      if (Date.now() - lastFailoverAt < FAILOVER_DEBOUNCE_MS) return;
      const failed = signal.provider || deps.currentProvider() || '';
      let toml: string;
      let target: ReturnType<typeof pickFailoverProvider>;
      try {
        toml = await deps.getConfig();
        target = pickFailoverProvider(toml, failed);
      } catch {
        return; // config 读不到时保持沉默 —— 不在错误风暴里叠加 UI 噪音。
      }
      if (!target) {
        deps.pushToast({
          kind: 'error',
          message: `「${failed || '当前计划'}」额度耗尽，且没有可用的备用计划 — 请在设置 → 编码计划中添加`,
          ttlMs: 8000,
        });
        return;
      }
      try {
        await deps.saveConfig(setActiveProvider(toml, target));
      } catch (e) {
        deps.pushToast({
          kind: 'error',
          message: `自动切换到 ${target} 失败: ${e instanceof Error ? e.message : String(e)}`,
          ttlMs: 8000,
        });
        return;
      }
      lastFailoverAt = Date.now();
      deps.pushToast({
        kind: 'success',
        message: `「${failed || '当前计划'}」额度耗尽，已自动切换默认供应商 → ${target}`,
        ttlMs: 8000,
      });
      deps.onSwitched(failed, target);
    },
  };
}

/** store 专用的接线工厂 —— 把 zustand 侧依赖(pushToast / set / session)
 * 与 IPC 命令封装成上面的纯依赖注入,store 构造期一行接入。
 * getConfig/saveConfig 用箭头包装延迟解引用 —— 测试环境部分 mock
 * @/utils/commands 时不至于在 store 构造期就触碰未导出的名字。 */
export function createWiredPlanFailoverController(
  get: () => {
    pushToast: PlanFailoverDeps['pushToast'];
    session: { provider: string | null } | null;
  },
  set: (patch: { planFailover: { from: string; to: string; at: number } }) => void,
): PlanFailoverController {
  return createPlanFailoverController({
    getConfig: () => zhuye_get_config(),
    saveConfig: (toml) => zhuye_save_config(toml),
    pushToast: (input) => {
      get().pushToast(input);
    },
    isEnabled: isAutoFailoverEnabled,
    onSwitched: (from, to) => set({ planFailover: { from, to, at: Date.now() } }),
    currentProvider: () => get().session?.provider ?? null,
  });
}
