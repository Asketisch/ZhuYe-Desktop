/**
 * Side-channel 封装(v1.x WP9)。
 *
 * 后端已收编引擎原生实现:命令把 `Op::Start/Cancel/QuerySideChannels`
 * 提交进 `AgentThread`,由 `SideChannelDriver`(state/thread_factory.rs
 * 构造注入)真正执行 agent;应答是与 submission id 配对的
 * `SideChannelStarted` / `SideChannelFinished` / `SideChannelStatus`
 * 事件(扇出到 `reflect_event` 通道)。前端通过查询快照 + 订阅
 * `side_channel_*` 事件刷新状态。
 */
import { invoke } from '../bridge';

// ── 类型(镜像 `zhuye_protocol::{SideChannelInfo, SideChannelEvent}`,camelCase) ──

export type ReflectSideChannelStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface ReflectSideChannelInfo {
  /** 稳定 id(`side-<8hex>`)。 */
  id: string;
  /** agent 定义名称。 */
  agentName: string;
  /** 初始 prompt。 */
  prompt: string;
  /** side-channel 注册时的 UNIX epoch 毫秒数。 */
  startedAtMs: number;
  /** 当前状态。 */
  status: ReflectSideChannelStatus;
  /** 已运行时长(毫秒);仍在运行时为 `null`。 */
  durationMs: number | null;
}

export interface ReflectStartSideChannelResult {
  id: string;
  agentName: string;
  prompt: string;
  startedAtMs: number;
}

// ── Commands ───────────────────────────────────────────────────────────

/**
 * 启动一条新的 side-channel。返回分配的 id 及快照字段。
 * 注册表在内部广播启动事件；桌面端当前通过列表查询刷新快照。
 */
export async function reflect_start_side_channel(args: {
  agent_name: string;
  prompt: string;
}): Promise<ReflectStartSideChannelResult> {
  return invoke<ReflectStartSideChannelResult>('reflect_start_side_channel', {
    // Tauri 2 平铺参数按 camelCase 匹配 Rust 参数名 `agent_name`。
    agentName: args.agent_name,
    prompt: args.prompt,
  });
}

/**
 * 按 id 取消一条运行中的 side-channel。已生效返回 `true`,
 * 未找到 / 已处于终止态返回 `false`。
 */
export async function reflect_cancel_side_channel(id: string): Promise<boolean> {
  return invoke<boolean>('reflect_cancel_side_channel', { id });
}

/** 列出当前所有 side-channel 快照。 */
export async function reflect_list_side_channels(): Promise<ReflectSideChannelInfo[]> {
  return invoke<ReflectSideChannelInfo[]>('reflect_list_side_channels');
}

/** 单条 side-channel 快照。id 未找到时抛错。 */
export async function reflect_get_side_channel(id: string): Promise<ReflectSideChannelInfo> {
  return invoke<ReflectSideChannelInfo>('reflect_get_side_channel', { id });
}
