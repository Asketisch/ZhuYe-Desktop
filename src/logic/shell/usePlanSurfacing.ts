/**
 * usePlanSurfacing —— 计划的「右 dock 呈递」策略。
 *
 * 计划不再用全局弹窗审批（ZCode 的 plan detail side pane 同款思路）：
 * - `pendingPlan` 出现（plan_ready / plan_request）→ 自动打开右 dock 并
 *   切到 inspector 的「计划」页签；
 * - 若收到的 `plan_request` 对应会话本来就处于计划模式（用户已显式选择
 *   或会话偏好为 plan），说明这是冗余 enter —— 直接以
 *   `manual_approve` 应答（Enter 方向目标恒为 Plan，后端 no-op），
 *   不向用户弹任何确认。
 *
 * 由 `ShellBinding` 挂载（全局唯一实例，换路由不丢）。
 */
import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { readPermissionPreference } from '@/stores/agent/permissionPreference';

export function usePlanSurfacing(): void {
  const pendingPlan = useAgentStore((s) => s.pendingPlan);
  const permissionMode = useAgentStore((s) => s.permissionMode);
  const loadedSessionId = useAgentStore((s) => s.loadedSessionId);
  const approvePlan = useAgentStore((s) => s.approvePlan);
  const seenRef = useRef<string | null>(null);

  // 计划到达 → 右 dock 计划页签（同一 plan id 只主动打开一次，
  // 用户手动收起后不再反复抢焦点）。
  useEffect(() => {
    if (!pendingPlan) {
      seenRef.current = null;
      return;
    }
    if (seenRef.current === pendingPlan.id) return;
    const redundantEnter =
      pendingPlan.kind === 'request'
      && (permissionMode === 'plan' || readPermissionPreference(loadedSessionId) === 'plan');
    if (redundantEnter) return;
    seenRef.current = pendingPlan.id;
    const ui = useShellUi.getState();
    ui.setDockMode('inspector');
    ui.setInspectorTab('plan');
    ui.setDockOpen(true);
  }, [pendingPlan, permissionMode, loadedSessionId]);

  // 已在计划模式下收到 EnterPlanMode 请求：静默应答，不弹确认。
  useEffect(() => {
    if (pendingPlan?.kind !== 'request') return;
    const preferred = readPermissionPreference(loadedSessionId);
    if (permissionMode !== 'plan' && preferred !== 'plan') return;
    void approvePlan(pendingPlan.id, 'manual_approve');
  }, [pendingPlan, permissionMode, loadedSessionId, approvePlan]);
}
