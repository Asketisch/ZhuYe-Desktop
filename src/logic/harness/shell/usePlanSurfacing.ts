/**
 * usePlanSurfacing —— 计划的「右 dock 呈递」策略。
 *
 * 计划不再用全局弹窗审批（ZCode 的 plan detail side pane 同款思路）：
 * - `pendingPlan`（plan_ready / plan_request）、会话已有 `plan`（终稿，
 *   含回放水合）、`planDraft`（草稿落盘）任一出现 → 自动打开右 dock
 *   的「计划」标签页（优先级高于旧的 inspector 子页签）；
 * - 按 `pendingPlan.id → plan.planId → planDraft.path` 去重，同一计划只
 *   主动展开一次（用户手动关掉标签页后不反复抢焦点）；
 * - 切会话时计划标签页跟随当前会话：新会话无计划则关闭该标签；
 * - 「草稿提交并执行」兜底路径：`consumeDraftSubmitPending()` 命中时，
 *   plan_ready 到达即自动批准 + 补发执行指令；
 * - 若收到的 `plan_request` 对应会话本来就处于计划模式，静默以
 *   `manual_approve` 应答（冗余 enter，不弹任何确认）。
 *
 * 由 `ShellBinding` 挂载（全局唯一实例，换路由不丢）。
 */
import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { readPermissionPreference } from '@/stores/agent/permissionPreference';
import { consumeDraftSubmitPending } from './planSubmitSignal';

/** 执行兜底指令：审批通过但回合已结束时补发，让 agent 接着干。 */
const FOLLOWUP_EXECUTE = '计划已批准，请按计划开始执行。';

export function usePlanSurfacing(): void {
  const pendingPlan = useAgentStore((s) => s.pendingPlan);
  const plan = useAgentStore((s) => s.plan);
  const planDraft = useAgentStore((s) => s.planDraft);
  const permissionMode = useAgentStore((s) => s.permissionMode);
  const loadedSessionId = useAgentStore((s) => s.loadedSessionId);
  const approvePlan = useAgentStore((s) => s.approvePlan);
  const submit = useAgentStore((s) => s.submit);
  const seenRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  // 计划出现 → 右 dock 计划标签（同一计划 id/路径只主动打开一次）。
  useEffect(() => {
    const key = pendingPlan?.id ?? plan?.planId ?? (planDraft?.path ?? null);
    if (!key) {
      seenRef.current = null;
      // 切到无计划会话：关掉上一会话遗留的计划标签页。
      if (sessionRef.current !== null && sessionRef.current !== loadedSessionId) {
        const ui = useShellUi.getState();
        const planTab = ui.dockTabs.find((tab) => tab.kind === 'plan');
        if (planTab) ui.closeDockTab(planTab.id);
      }
      sessionRef.current = loadedSessionId ?? null;
      return;
    }
    sessionRef.current = loadedSessionId ?? null;
    if (seenRef.current === key) return;
    seenRef.current = key;
    useShellUi.getState().openDockTab('plan');
  }, [pendingPlan, plan, planDraft, loadedSessionId]);

  // plan_ready 到达时：草稿提交兜底 → 自动批准 + 补发执行指令。
  useEffect(() => {
    if (pendingPlan?.kind !== 'ready') return;
    if (!consumeDraftSubmitPending()) return;
    void approvePlan(pendingPlan.id, 'auto_mode').then(() => {
      void submit(FOLLOWUP_EXECUTE).catch(() => undefined);
    });
  }, [pendingPlan, approvePlan, submit]);

  // 已在计划模式下收到 EnterPlanMode 请求：静默应答，不弹确认。
  useEffect(() => {
    if (pendingPlan?.kind !== 'request') return;
    const preferred = readPermissionPreference(loadedSessionId);
    if (permissionMode !== 'plan' && preferred !== 'plan') return;
    void approvePlan(pendingPlan.id, 'manual_approve');
  }, [pendingPlan, permissionMode, loadedSessionId, approvePlan]);
}
