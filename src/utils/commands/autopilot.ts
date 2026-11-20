/**
 * Autopilot IPC 包装。
 *
 * Phase 3 条目 10：自动任务调度。
 */
import { invoke } from '@/utils/bridge';

// ── 类型 ──

export interface ZhuyeAutopilotConfig {
  enabled: boolean;
  schedule: string;
  taskTemplate: string;
  agent: string | null;
  maxConcurrent: number;
}

export interface ZhuyeAutopilotRun {
  id: string;
  executedAtMs: number;
  taskId: string | null;
  status: 'success' | 'failed' | 'inProgress' | 'skipped';
  error: string | null;
}

// ── Wrappers ──

export function zhuye_get_autopilot_config(): Promise<ZhuyeAutopilotConfig> {
  return invoke('zhuye_get_autopilot_config');
}

export function zhuye_update_autopilot_config(config: ZhuyeAutopilotConfig): Promise<void> {
  return invoke('zhuye_update_autopilot_config', { config });
}

export function zhuye_autopilot_history(): Promise<ZhuyeAutopilotRun[]> {
  return invoke('zhuye_autopilot_history');
}