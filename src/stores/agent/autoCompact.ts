/**
 * 按 plan 的最大上下文自动压缩（GUI 侧补齐，跨供应商 failover 同款模式）。
 *
 * 背景：runtime 的自动压缩只认全局 `[compact].trigger_tokens`（固定阈值，
 * 不感知模型窗口）；plan 的"最大上下文"落在 `[context_windows][model]`，
 * runtime 会级联进 `session_configured.context_window_size`（仪表/工具），
 * 但不参与压缩触发。本模块在前端补齐：监听 `token_count` 事件，当已上报
 * 的输入 token 超过 max_context 的 80% 时自动调用 `reflect_compact`
 * （Op::Compact，下一轮 pre_loop 执行压缩），回落到 50% 以下重新武装。
 *
 * 依赖注入（getConfig/compact）使控制器可脱离 zustand 与 Tauri IPC 单测。
 */
import {
  listPlans,
  readActiveCredential,
  readActiveProvider,
  readContextWindowForModel,
} from '@/features/settings/config/plans';
import { readField } from '@/features/settings/config/schema';

export const AUTO_COMPACT_PREF_KEY = 'reflect.autoCompact';

/** 默认开启；localStorage 显式写 'off' 才关闭（隐私模式下默认开）。 */
export function isAutoCompactEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_COMPACT_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 触发阈值：已用输入 token ≥ max_context × 80%。 */
const TRIGGER_RATIO = 0.8;
/** 重新武装阈值：回落到 max_context × 50% 以下才允许再次触发。 */
const RESET_RATIO = 0.5;
/** 解析配置的节流间隔（token_count 高频，避免每次都读 config）。 */
const CHECK_THROTTLE_MS = 30_000;

export interface AutoCompactDeps {
  getConfig: () => Promise<string>;
  compact: () => Promise<unknown>;
}

export function createAutoCompactController(deps: AutoCompactDeps) {
  let compacted = false; // 触发闩：压缩后 token 不会立刻下降，防止连环触发
  let lastCheck = 0;
  let lastModel = '';

  /** 当前生效 plan 的最大上下文（config `[context_windows][model]`）。 */
  async function resolveMaxContext(modelUsed?: string | null): Promise<number | null> {
    let toml: string;
    try {
      toml = await deps.getConfig();
    } catch {
      return null; // 配置不可读 → 不做任何事
    }
    const provider = readActiveProvider(toml);
    if (!provider) return null;
    // 模型名：`[<provider>].model` 段级覆盖优先，回落到该 provider 下第一个有 model 的 plan。
    const credential = readActiveCredential(toml);
    const plans = listPlans(toml).filter((p) => p.provider === provider);
    const model = (modelUsed?.startsWith(`${provider}/`) ? modelUsed.slice(provider.length + 1) : modelUsed) ||
      plans.find((p) => p.label === credential)?.model ||
      readField(toml, provider, 'model') || plans.find((p) => p.model)?.model || '';
    const raw = readContextWindowForModel(toml, model);
    const parsed = Number(raw);
    return raw && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  /** `token_count` 事件入口（input = 最新上报的输入 token 数）。 */
  return async function onTokenCount(inputTokens: number, model?: string | null, windowSize?: number | null): Promise<void> {
    if (!isAutoCompactEnabled() || inputTokens <= 0) return;
    const identity = `${model ?? ''}:${windowSize ?? ''}`;
    if (identity !== lastModel) {
      lastModel = identity;
      compacted = false;
      lastCheck = 0;
    }
    const now = Date.now();
    if (now - lastCheck < CHECK_THROTTLE_MS) return;
    // throttle 先记下"我们即将做一次检查",但只有 maxContext 真正被解析、
    // 并且触发了压缩/重置逻辑之后,才把 lastCheck 推到 now;避免 getConfig
    // 在磁盘热重载时阻塞,白白丢掉随后 30 秒内的 token_count 事件。
    const maxContext = await resolveMaxContext(model) ?? (windowSize && windowSize > 0 ? windowSize : null);
    if (!maxContext) return;
    lastCheck = now;

    if (inputTokens >= maxContext * TRIGGER_RATIO) {
      if (compacted) return; // 闩已落下，等回落
      compacted = true;
      try {
        await deps.compact();
      } catch {
        compacted = false; // 触发失败允许下个窗口重试
      }
    } else if (inputTokens < maxContext * RESET_RATIO) {
      compacted = false;
    }
  };
}
