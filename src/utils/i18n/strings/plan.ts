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
};

export default plan;
