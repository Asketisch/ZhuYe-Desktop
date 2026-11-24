/**
 * 计划草稿「提交并执行」的一次性信号。
 *
 * 场景：模型写完 plan 草稿却用纯文本收尾（旧会话 / 引擎守卫未覆盖的
 * 边界），此时没有 `plan_ready`、前端拿不到 pendingPlan。用户点
 * 「提交并执行」→ 调 `exit_plan_mode`（引擎读真实 plan 文件发 plan_ready）
 * → 本信号让 `usePlanSurfacing` 在 plan_ready 到达后自动批准并补发一条
 * 执行指令，避免用户再点第二次。
 *
 * 模块级单例即可（全局只有一个 usePlanSurfacing 在消费）。
 */

let draftSubmitPending = false;

/** 标记「下一次 plan_ready 到达后自动批准并执行」。 */
export function markDraftSubmitPending(): void {
  draftSubmitPending = true;
}

/** 取出并清除信号（消费一次即失效，避免误批下一份计划）。 */
export function consumeDraftSubmitPending(): boolean {
  const pending = draftSubmitPending;
  draftSubmitPending = false;
  return pending;
}
