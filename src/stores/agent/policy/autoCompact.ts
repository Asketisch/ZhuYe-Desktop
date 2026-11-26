/**
 * 按模型上下文自动压缩（GUI 侧补齐，跨供应商 failover 同款模式）。
 *
 * 背景：runtime 的自动压缩只认全局 `[compact].trigger_tokens`（固定阈值，
 * 不感知模型窗口）；模型的"最大上下文"落在 `[context_windows][model]`
 * （GUI 设置）或 models.dev 目录（级联进
 * `session_configured.context_window_size`），但不参与压缩触发。本模块在
 * 前端补齐：监听 `token_count` 事件，当已上报的输入 token 超过
 * max_context × 阈值比例时自动调用 `zhuye_compact`（Op::Compact，下一轮
 * pre_loop 执行压缩），回落到 50% 以下重新武装。
 *
 * 阈值比例读**当前活跃模型组的 `auto_compact` 字段**（设置页模型详情
 * 可配，引擎 ModelGroupSection.auto_compact 仅作持久化位），缺省 85%。
 * 依赖注入（getConfig/compact）使控制器可脱离 zustand 与 Tauri IPC 单测。
 */
import {
  listGroups,
  readActiveCredential,
  readActiveGroup,
} from '@/logic/knowledge/models/modelGroups';
import { readContextWindowForModel } from '@/logic/harness/settings/config/toml';

/** 默认触发阈值：已用输入 token ≥ max_context × 85%。 */
export const DEFAULT_TRIGGER_RATIO = 0.85;
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

  /** 当前生效 plan 的最大上下文与触发比例（config `[context_windows][model]`
   * + 活跃模型组的 `auto_compact`；组未配置阈值时回落默认 85%，越界值
   * 钳制到 5%-95% 防呆）。 */
  async function resolveMaxContext(modelUsed?: string | null): Promise<{ maxContext: number; ratio: number } | null> {
    let toml: string;
    try {
      toml = await deps.getConfig();
    } catch {
      return null; // 配置不可读 → 不做任何事
    }
    const groupId = readActiveGroup(toml);
    if (!groupId) return null;
    // 模型名：spec 前缀（`<组id>/`）去掉后是裸模型名；没给 spec 时回落到
    // 钉住凭据的 model → 组级默认 model → 组内任一有 model 的凭据。
    const group = listGroups(toml).find((g) => g.id === groupId);
    const credential = readActiveCredential(toml);
    const model = (modelUsed?.startsWith(`${groupId}/`) ? modelUsed.slice(groupId.length + 1) : modelUsed) ||
      group?.credentials.find((c) => c.label === credential)?.model ||
      group?.model ||
      group?.credentials.find((c) => c.model)?.model || '';
    const raw = readContextWindowForModel(toml, model);
    const parsed = Number(raw);
    const maxContext = raw && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (!maxContext) return null;
    const configured = group?.autoCompact;
    const ratio = configured != null && Number.isFinite(configured) && configured > 0 && configured < 1
      ? configured
      : DEFAULT_TRIGGER_RATIO;
    return { maxContext, ratio: Math.min(0.95, Math.max(0.05, ratio)) };
  }

  /** `token_count` 事件入口（input = 最新上报的输入 token 数）。 */
  return async function onTokenCount(inputTokens: number, model?: string | null, windowSize?: number | null): Promise<void> {
    if (inputTokens <= 0) return;
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
    const resolved = await resolveMaxContext(model) ??
      (windowSize && windowSize > 0 ? { maxContext: windowSize, ratio: DEFAULT_TRIGGER_RATIO } : null);
    if (!resolved) return;
    lastCheck = now;
    const { maxContext, ratio } = resolved;

    if (inputTokens >= maxContext * ratio) {
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
