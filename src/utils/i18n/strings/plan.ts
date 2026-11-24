/**
 * i18n 命名空间 —— plan.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const plan: Record<string, StringEntry> = {
  'plan.title':     { en: 'Plan Mode',                                 'zh-CN': '计划模式' },
  'plan.subtitle':  { en: 'Review and approve plans submitted by the agent.',            'zh-CN': '审查和批准 agent 提交的计划。' },
  'plan.enter':     { en: 'Enter plan mode',                           'zh-CN': '进入计划模式' },
  'plan.exit':      { en: 'Exit plan mode',                            'zh-CN': '退出计划模式' },
  'plan.empty':     { en: 'No plan yet — start a turn to draft one.',  'zh-CN': '暂无计划——开始对话来起草。' },
  'plan.approve':   { en: 'Approve plan',                              'zh-CN': '批准计划' },
  'plan.reject':    { en: 'Reject plan',                               'zh-CN': '拒绝计划' },
  'plan.autoMode':  { en: 'Auto Mode',                                 'zh-CN': '自动模式' },
  'plan.manualApprove': { en: 'Manual Approve',                        'zh-CN': '手动审批' },
  'plan.revise':    { en: 'Revise',                                    'zh-CN': '修改' },
  'plan.pending':   { en: 'Pending',                                   'zh-CN': '等待中' },
  'plan.approved':  { en: 'Approved',                                  'zh-CN': '已批准' },
  'plan.rejected':  { en: 'Rejected',                                  'zh-CN': '已拒绝' },
  'plan.sampleData': { en: 'sample data',                              'zh-CN': '示例数据' },
  'plan.usePlanHint': { en: 'Use /plan in chat to create one.',        'zh-CN': '在对话中使用 /plan 创建计划。' },
  'plan.progressTitle': { en: 'Execution progress',                   'zh-CN': '执行进度' },
  'plan.stepStatus.pending':    { en: 'pending',                        'zh-CN': '待执行' },
  'plan.stepStatus.in_progress': { en: 'in progress',                  'zh-CN': '执行中' },
  'plan.stepStatus.done':       { en: 'done',                           'zh-CN': '已完成' },
  'plan.stepStatus.skipped':    { en: 'skipped',                        'zh-CN': '已跳过' },
  // ── 计划审批条（输入框上方）+ 右 dock 计划页签的挂起卡片 ──────────
  'plan.bar.readyTitle':        { en: 'Plan ready',                      'zh-CN': '计划已就绪' },
  'plan.bar.readyHint':         { en: 'Review it in the plan panel, then approve — or type feedback to revise.', 'zh-CN': '可在右侧计划面板查看全文；同意即开始执行，或输入修改意见打回修订。' },
  'plan.bar.approveExecution':  { en: 'Approve & execute',               'zh-CN': '同意执行计划' },
  'plan.bar.manualApprove':     { en: 'Step-by-step approval',           'zh-CN': '逐项确认' },
  'plan.bar.viewPlan':          { en: 'View plan',                       'zh-CN': '查看计划' },
  'plan.bar.requestTitle':      { en: 'Agent requested plan mode',       'zh-CN': 'Agent 请求进入计划模式' },
  'plan.bar.requestEnter':      { en: 'Enter plan mode',                 'zh-CN': '进入计划模式' },
  'plan.bar.requestDecline':    { en: 'Not now',                         'zh-CN': '暂不进入' },
  'plan.card.pendingTitle':     { en: 'Plan awaiting approval',          'zh-CN': '等待确认的计划' },
  'plan.card.approveExecution': { en: 'Approve & execute',               'zh-CN': '同意执行计划' },
  'plan.card.manualApprove':    { en: 'Step-by-step approval',           'zh-CN': '逐项确认' },
  'plan.card.revise':           { en: 'Revise (type feedback below)',    'zh-CN': '打回修订（在输入框写反馈）' },
  'plan.card.enter':            { en: 'Enter plan mode',                 'zh-CN': '进入计划模式' },
  'plan.card.decline':          { en: 'Not now',                         'zh-CN': '暂不进入' },
};

export default plan;
