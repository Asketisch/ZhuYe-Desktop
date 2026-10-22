/**
 * 远程模式封装 —— Phase 2 第 2 项(Tailscale + iOS 守护进程)。
 *
 * 对应 `src-tauri/src/commands/remote.rs`(其内部封装
 * `reflect-app-core::tailscale` + `state::RemoteConfig`)。
 *
 * 暂不在范围内(后续轮次):
 *   - 独立的 TCP JSON-RPC 守护进程二进制(`reflect_daemon`)。
 *   - 维护实时连接状态的 transport driver。
 *   - `reflect_tailscale_daemon_start / stop / status` 目前是占位命令,
 *     直接返回 `"not implemented yet"`,以便前端展示友好提示,而非假装
 *     启动一个尚不存在的守护进程。
 */
import { invoke } from '../bridge';

// ── 类型(对应 `commands/remote.rs::RemoteConfigSnapshot` / `state::RemoteStatus` / app-core tailscale) ──
// 后端三个快照结构都标了 `#[serde(rename_all = "camelCase")]`,线上字段是 camelCase。

export interface ReflectRemoteConfigSnapshot {
  host: string;
  port: number;
  authToken: string | null;
  autoConnect: boolean;
  endpoint: string;
  isReady: boolean;
}

export interface ReflectRemoteStatus {
  state: 'connected' | 'disconnected' | 'error' | string;
  message: string | null;
  endpoint: string | null;
  sinceMs: number | null;
}

/** Tailscale 状态(camelCase,对应 `app_core::tailscale::TailscaleStatus`)。 */
export interface ReflectTailscaleStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  dnsName: string | null;
  hostName: string | null;
  tailnetName: string | null;
  ipv4: string[];
  ipv6: string[];
  suggestedRemoteHost: string | null;
  message: string | null;
}

// ── Commands ───────────────────────────────────────────────────────────

/** 读取当前 remote 配置(host / port / authToken / autoConnect)。 */
export async function reflect_get_remote_config(): Promise<ReflectRemoteConfigSnapshot> {
  return invoke<ReflectRemoteConfigSnapshot>('reflect_get_remote_config');
}

/** 覆盖 remote 配置并返回更新后的快照。Tauri 按 camelCase 取 Rust 参数 `auth_token` / `auto_connect`。 */
export async function reflect_update_remote_config(args: {
  host: string;
  port?: number;
  authToken?: string | null;
  autoConnect?: boolean;
}): Promise<ReflectRemoteConfigSnapshot> {
  return invoke<ReflectRemoteConfigSnapshot>('reflect_update_remote_config', {
    host: args.host,
    port: args.port ?? null,
    authToken: args.authToken ?? null,
    autoConnect: args.autoConnect ?? null,
  });
}

/** 读取运行时 transport 状态(driver 接入前固定为 `disconnected`)。 */
export async function reflect_get_remote_status(): Promise<ReflectRemoteStatus> {
  return invoke<ReflectRemoteStatus>('reflect_get_remote_status');
}

/** 探测本地 Tailscale 守护进程。任何失败均返回降级状态。 */
export async function reflect_tailscale_status(): Promise<ReflectTailscaleStatus> {
  return invoke<ReflectTailscaleStatus>('reflect_tailscale_status');
}

/** iOS 配对卡片上的提示字符串(用户在桌面端运行的命令)。 */
export async function reflect_tailscale_daemon_command_preview(): Promise<string> {
  return invoke<string>('reflect_tailscale_daemon_command_preview');
}

/** 占位命令:启动桌面守护进程。当前返回 `not implemented yet`。 */
export async function reflect_tailscale_daemon_start(): Promise<string> {
  return invoke<string>('reflect_tailscale_daemon_start');
}

/** 占位命令:停止桌面守护进程。 */
export async function reflect_tailscale_daemon_stop(): Promise<string> {
  return invoke<string>('reflect_tailscale_daemon_stop');
}

/** 占位命令:查询桌面守护进程的运行状态。 */
export async function reflect_tailscale_daemon_status(): Promise<string> {
  return invoke<string>('reflect_tailscale_daemon_status');
}