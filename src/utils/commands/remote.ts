/**
 * 远程模式封装 —— Phase 2 第 2 项(Tailscale + iOS 守护进程)。
 *
 * 对应 `src-tauri/src/commands/remote.rs`(其内部封装
 * `zhuye-app-core::tailscale` + `state::RemoteConfig`)。
 *
 * 暂不在范围内(后续轮次):
 *   - 独立的 TCP JSON-RPC 守护进程二进制(`zhuye_daemon`)。
 *   - 维护实时连接状态的 transport driver。
 *   - `zhuye_tailscale_daemon_start / stop / status` 目前是占位命令,
 *     直接返回 `"not implemented yet"`,以便前端展示友好提示,而非假装
 *     启动一个尚不存在的守护进程。
 */
import { invoke } from '../bridge';

// ── 类型(对应 `commands/remote.rs::RemoteConfigSnapshot` / `state::RemoteStatus` / app-core tailscale) ──
// 后端三个快照结构都标了 `#[serde(rename_all = "camelCase")]`,线上字段是 camelCase。

export interface ZhuyeRemoteConfigSnapshot {
  host: string;
  port: number;
  authToken: string | null;
  autoConnect: boolean;
  endpoint: string;
  isReady: boolean;
}

export interface ZhuyeRemoteStatus {
  state: 'connected' | 'disconnected' | 'error' | string;
  message: string | null;
  endpoint: string | null;
  sinceMs: number | null;
}

/** Tailscale 状态(camelCase,对应 `app_core::tailscale::TailscaleStatus`)。 */
export interface ZhuyeTailscaleStatus {
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
export async function zhuye_get_remote_config(): Promise<ZhuyeRemoteConfigSnapshot> {
  return invoke<ZhuyeRemoteConfigSnapshot>('zhuye_get_remote_config');
}

/** 覆盖 remote 配置并返回更新后的快照。Tauri 按 camelCase 取 Rust 参数 `auth_token` / `auto_connect`。 */
export async function zhuye_update_remote_config(args: {
  host: string;
  port?: number;
  authToken?: string | null;
  autoConnect?: boolean;
}): Promise<ZhuyeRemoteConfigSnapshot> {
  return invoke<ZhuyeRemoteConfigSnapshot>('zhuye_update_remote_config', {
    host: args.host,
    port: args.port ?? null,
    authToken: args.authToken ?? null,
    autoConnect: args.autoConnect ?? null,
  });
}

/** 读取运行时 transport 状态(driver 接入前固定为 `disconnected`)。 */
export async function zhuye_get_remote_status(): Promise<ZhuyeRemoteStatus> {
  return invoke<ZhuyeRemoteStatus>('zhuye_get_remote_status');
}

/** 探测本地 Tailscale 守护进程。任何失败均返回降级状态。 */
export async function zhuye_tailscale_status(): Promise<ZhuyeTailscaleStatus> {
  return invoke<ZhuyeTailscaleStatus>('zhuye_tailscale_status');
}

/** iOS 配对卡片上的提示字符串(用户在桌面端运行的命令)。 */
export async function zhuye_tailscale_daemon_command_preview(): Promise<string> {
  return invoke<string>('zhuye_tailscale_daemon_command_preview');
}

/** 占位命令:启动桌面守护进程。当前返回 `not implemented yet`。 */
export async function zhuye_tailscale_daemon_start(): Promise<string> {
  return invoke<string>('zhuye_tailscale_daemon_start');
}

/** 占位命令:停止桌面守护进程。 */
export async function zhuye_tailscale_daemon_stop(): Promise<string> {
  return invoke<string>('zhuye_tailscale_daemon_stop');
}

/** 占位命令:查询桌面守护进程的运行状态。 */
export async function zhuye_tailscale_daemon_status(): Promise<string> {
  return invoke<string>('zhuye_tailscale_daemon_status');
}
// ── v1.11 基建#12:远程网页访问状态服务器 ─────────────────────────────

/** 启动状态服务器(GET /status 只读诊断 JSON;auth_token 非空时强制校验)。返回实际端口。 */
export async function zhuye_status_server_start(port?: number): Promise<number> {
  return invoke<number>('zhuye_status_server_start', { port: port ?? null });
}

/** 停止状态服务器(未运行时 no-op)。 */
export async function zhuye_status_server_stop(): Promise<void> {
  await invoke<void>('zhuye_status_server_stop');
}

/** 当前状态服务器运行端口;未启动为 null。 */
export async function zhuye_status_server_state(): Promise<number | null> {
  return invoke<number | null>('zhuye_status_server_state');
}
// ── SSH 远程开发(会话层接缝;docs/plans/ssh-remote.md)────────────────
//
// 远端跑 `zhuye serve`(stdio JSONL),桌面以 SSH 子进程为传输成为协议
// 客户端。host 注册表持久化 `$ZHUYE_HOME/remote-hosts.json`;连接经
// `zhuye_remote_connect` 返回会话 id,`setActiveId(sid)` 即进入
// /chat/<sid>(ChatView 的 bind 对远程 sid 短路:后端置前台插槽,
// 后续 submit/interrupt 整条路由远端 stdin)。

/** 远程主机(注册表条目,camelCase 出线)。 */
export interface ZhuyeRemoteHost {
  name: string;
  host: string;
  port: number;
  user: string | null;
}

/** 活跃远程会话信息。 */
export interface ZhuyeRemoteSessionInfo {
  sid: string;
  host: string;
  cwd: string;
  isForeground: boolean;
}

/** 远程主机列表(注册表读口)。 */
export async function zhuye_remote_hosts(): Promise<ZhuyeRemoteHost[]> {
  return invoke<ZhuyeRemoteHost[]>('zhuye_remote_hosts');
}

/** 新增/覆盖一台远程主机(按 name 幂等)。返回更新后的列表。 */
export async function zhuye_remote_host_save(args: {
  name: string;
  host: string;
  port?: number;
  user?: string;
}): Promise<ZhuyeRemoteHost[]> {
  return invoke<ZhuyeRemoteHost[]>('zhuye_remote_host_save', {
    name: args.name,
    host: args.host,
    port: args.port ?? null,
    user: args.user ?? null,
  });
}

/** 删除一台远程主机。返回更新后的列表。 */
export async function zhuye_remote_host_remove(name: string): Promise<ZhuyeRemoteHost[]> {
  return invoke<ZhuyeRemoteHost[]>('zhuye_remote_host_remove', { name });
}

/** 连通性 + 远端 CLI 探测(`ssh <host> -- zhuye --version`)。 */
export async function zhuye_remote_test(args: {
  host: string;
  port?: number;
  user?: string;
}): Promise<string> {
  return invoke<string>('zhuye_remote_test', {
    host: args.host,
    port: args.port ?? null,
    user: args.user ?? null,
  });
}

/** 远端一键安装 zhuye CLI(bootstrap)。返回安装后的版本输出行。 */
export async function zhuye_remote_bootstrap(host: string): Promise<string> {
  return invoke<string>('zhuye_remote_bootstrap', { host });
}

/** 连接远程会话(拉起 serve + 握手)。返回会话 id。 */
export async function zhuye_remote_connect(host: string, cwd: string): Promise<string> {
  return invoke<string>('zhuye_remote_connect', { host, cwd });
}

/** bind 到远程会话(前台插槽置位)。 */
export async function zhuye_remote_bind(sid: string): Promise<void> {
  await invoke<void>('zhuye_remote_bind', { sid });
}

/** 断开远程会话(杀 serve 子进程;远端 rollout 已落盘)。 */
export async function zhuye_remote_disconnect(sid: string): Promise<void> {
  await invoke<void>('zhuye_remote_disconnect', { sid });
}

/** 活跃远程会话列表。 */
export async function zhuye_remote_sessions(): Promise<ZhuyeRemoteSessionInfo[]> {
  return invoke<ZhuyeRemoteSessionInfo[]>('zhuye_remote_sessions');
}
