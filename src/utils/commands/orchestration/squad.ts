/**
 * Squad + Leader 委派 IPC 封装(Phase 3 第 11 项)。
 *
 * 薄封装 6 个 squad 命令。与后端 `zhuye_app_core::squad::SquadSpec`
 * camelCase 类型对齐;Task 类型复用 `./tasks` 中的 `ZhuyeTask`。
 */
import { invoke } from '@/utils/bridge';
import type { ZhuyeActor } from '../telemetry/activity';
import type { ZhuyeTask } from './tasks';

export interface ZhuyeSquadMember {
  actor: ZhuyeActor;
  role: string;
  model?: string | null;
  systemPrompt: string;
  allowedTools: string[];
}

export interface ZhuyeSquadSpec {
  name: string;
  description?: string | null;
  leaderActor: ZhuyeActor;
  members: ZhuyeSquadMember[];
  createdAtMs: number;
}

export function zhuye_list_squads(): Promise<ZhuyeSquadSpec[]> {
  return invoke('zhuye_list_squads');
}

export function zhuye_create_squad(spec: ZhuyeSquadSpec): Promise<void> {
  return invoke('zhuye_create_squad', { spec });
}

export function zhuye_get_squad(name: string): Promise<ZhuyeSquadSpec> {
  return invoke('zhuye_get_squad', { name });
}

export function zhuye_delete_squad(name: string): Promise<void> {
  return invoke('zhuye_delete_squad', { name });
}

export function zhuye_delegate_next(
  name: string,
  leaderActorId: string,
): Promise<ZhuyeTask | null> {
  return invoke('zhuye_delegate_next', { name, leaderActorId });
}

export function zhuye_assign_squad_task(
  name: string,
  taskId: number,
  assignee: string | null,
): Promise<ZhuyeTask> {
  return invoke('zhuye_assign_squad_task', { name, taskId, assignee });
}
