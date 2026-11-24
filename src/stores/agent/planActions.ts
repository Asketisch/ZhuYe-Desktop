/**
 * plan 域 store actions 工厂（queue.ts / toast.ts 同款模式，自 store.ts
 * 拆出守 500 行预算）：plan 审批应答 + 工作模式切换。
 *
 * approvePlan 的容错语义是「计划审批卡死修复」的一半：命令失败
 * （会话已切走 / 引擎查无 waiter）时 toast 告知 + 照常清挂起态 ——
 * gate 在引擎侧已死，审批条（composer 审批条 / 右 dock 计划页签卡片）
 * 留着只会阻塞会话。僵尸条目不再重发的另一半
 * 在后端 `resolved_plan_gates` 过滤（src-tauri state/agent.rs）。
 */
import { t } from '@/utils/i18n/lookup';
import {
  zhuye_cycle_permission_mode,
  zhuye_enter_plan_mode,
  zhuye_exit_plan_mode,
  zhuye_plan_approval,
  zhuye_set_permission_mode,
} from '@/utils/commands';
import type { StoreApi } from 'zustand';
import type { PlanApprovalChoice } from '@/types/protocol';
import type { AgentState } from './types';

type SetAgentState = StoreApi<AgentState>['setState'];
type GetAgentState = StoreApi<AgentState>['getState'];

export function createPlanActions(set: SetAgentState, get: GetAgentState) {
  return {
    // plan 审批走独立的 approvePlan —— PlanApprovalChoice 三选一,语义与
    // tool/hook 的 ReviewDecision 不同,故单独方法。
    approvePlan: async (id: string, choice: PlanApprovalChoice) => {
      try {
        await zhuye_plan_approval(id, choice);
      } catch (error) {
        // 命令失败(会话已切走 / 引擎查无 waiter)不能把弹窗吊死:toast
        // 告知 + 照常清挂起态。gate 在引擎侧已死(waiter 被摘/线程被
        // 重建),弹窗留着只会阻塞会话 —— 实测「确认 plan 后卡住」的
        // 体验即由此而来。
        get().pushToast({
          kind: 'error',
          message: t('modal.planRequest.failed', undefined, {
            msg: error instanceof Error ? error.message : String(error),
          }),
        });
      }
      set((state) => state.pendingPlan?.id === id && state.pendingPlan.kind === 'request'
        ? { pendingPlan: null }
        : {});
    },

    enterPlanMode: async (task: string) => {
      await zhuye_enter_plan_mode(task);
    },
    exitPlanMode: async () => {
      await zhuye_exit_plan_mode();
    },
    setPermissionMode: async (mode: string) => {
      await zhuye_set_permission_mode(mode);
    },
    cyclePermissionMode: async () => {
      await zhuye_cycle_permission_mode();
    },
  };
}
