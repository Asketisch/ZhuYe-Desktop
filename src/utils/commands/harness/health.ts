/**
 * 健康检查 / 探针命令。
 *
 * 封装独立的 `ping` 命令,用于启动时及 `bridge.test.ts` 中探活 Tauri 后端。
 */
import { invoke } from '../../bridge';

/** 探活 Tauri 后端;返回 protocol/agent 版本信息。 */
export async function ping(): Promise<{ msg: string; version: string }> {
  return invoke<{ msg: string; version: string }>('ping');
}
