/**
 * 模型组额度耗尽自动切换（跨模型组 failover）。
 *
 * 分层职责：
 *  - 同组内凭据切换（429/401/5xx 冷却 + failover）由上游
 *    zhuye-core graph 层完成，GUI 无需介入；
 *  - **跨模型组**的切换（`[active].group` → 备用组）没有上游编排，
 *    由本模块在前端补齐：监听 `quota_exhausted` / `error` 事件,
 *    判定耗尽 → 挑选备用模型组 → `zhuye_save_config` 落盘 →
 *    后端热重载模型栈（`state/reload.rs`）→ toast 告知用户。
 *
 * 「模型组」是配置里唯一的接入层：组 id 既是 `[active].group` 的写入值，
 * 也是引擎侧的池名 —— 旧的内置编码套餐（plan）概念整层删除，套餐能力
 * 下沉为组内凭据，由组内轮换消化。
 *
 * 依赖注入（getConfig/saveConfig/pushToast）使控制器可脱离 zustand
 * 与 Tauri IPC 单测。
 */

import {
  groupHasUsableCredential,
  listGroups,
  pickFailoverGroup,
  setActiveGroup,
} from '@/logic/knowledge/models/modelGroups';
import { zhuye_get_config, zhuye_save_config } from '@/utils/commands';
import type { ToastKind } from '../types/types';

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

/** 两次自动切换之间的防抖窗口：切换后给新组至少 60s 观察/重试时间。 */
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
  /** 耗尽的模型组 id（事件未指明时回退当前会话组，可能为 ''）。 */
  group: string;
  /** 事件给的组内凭据 label（quota_exhausted 才有）。 */
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
 *
 * 事件里的 `provider` 字段在新契约下承载的是**模型组 id**（组 id 即
 * 引擎池名），原样当作组 id 使用。
 */
export function extractExhaustionSignal(
  msg: ExhaustedMsgLike,
  currentGroup: string | null,
): PlanExhaustionSignal | null {
  if (msg.type === 'quota_exhausted') {
    return {
      group: msg.provider ?? currentGroup ?? '',
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
    group: (readDetailsProvider(msg.details) ?? currentGroup ?? ''),
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
  /** 写回 config（zhuye_save_config；后端随即热重载模型栈）。 */
  saveConfig: (toml: string) => Promise<unknown>;
  pushToast: (input: { kind: ToastKind; message: string; ttlMs?: number }) => unknown;
  /** 自动切换开关（UI 偏好，默认开）。 */
  isEnabled: () => boolean;
  /** 切换成功回调（store 记录 planFailover 状态供状态栏展示）。 */
  onSwitched: (from: string, to: string) => void;
  /** 当前会话的接入目标（模型组 id；事件未指明时兜底）。 */
  currentGroup: () => string | null;
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
      const failed = signal.group || deps.currentGroup() || '';
      let toml: string;
      let target: ReturnType<typeof pickFailoverGroup>;
      try {
        toml = await deps.getConfig();
        target = pickFailoverGroup(toml, failed);
      } catch {
        return; // config 读不到时保持沉默 —— 不在错误风暴里叠加 UI 噪音。
      }
      if (!target) {
        deps.pushToast({
          kind: 'error',
          message: `「${failed || '当前模型组'}」额度耗尽，且没有可用的备用模型组 — 请在设置 → 模型组中添加`,
          ttlMs: 8000,
        });
        return;
      }
      // 当前组是否还剩可用凭据：整组耗尽（组内凭据全不可用）与单条凭据
      // 耗尽要说不同的话 —— 前者是「换组」，后者引擎侧池内轮换即可消化。
      const current = listGroups(toml).find((g) => g.id === failed) ?? null;
      const groupDrained = current !== null && !groupHasUsableCredential(current);
      try {
        // 写 `[active].group` = 目标组 id（组 id 才是接入目标）。
        await deps.saveConfig(setActiveGroup(toml, target.id));
      } catch (e) {
        deps.pushToast({
          kind: 'error',
          message: `自动切换到模型组 ${target.id} 失败: ${e instanceof Error ? e.message : String(e)}`,
          ttlMs: 8000,
        });
        return;
      }
      lastFailoverAt = Date.now();
      deps.pushToast({
        kind: 'success',
        message: groupDrained
          ? `「${failed || '当前模型组'}」整组凭据已耗尽，已自动切换模型组 → ${target.id}`
          : `「${failed || '当前模型组'}」额度耗尽，已自动切换模型组 → ${target.id}`,
        ttlMs: 8000,
      });
      deps.onSwitched(failed, target.id);
    },
  };
}

/** store 专用的接线工厂 —— 把 zustand 侧依赖(pushToast / set / session)
 * 与 IPC 命令封装成上面的纯依赖注入,store 构造期一行接入。
 * getConfig/saveConfig 用箭头包装延迟解引用 —— 测试环境部分 mock
 * @/utils/commands 时不至于在 store 构造期就触碰未导出的名字。
 *
 * 会话里的 `session.provider` 是引擎侧的池名 —— 新契约下它就是**模型组
 * id**，直接当作当前组使用。 */
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
    currentGroup: () => get().session?.provider ?? null,
  });
}
