/**
 * i18n 命名空间 —— modal.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const modal: Record<string, StringEntry> = {
  'modal.close':                  { en: 'Close',                                                                                      'zh-CN': '关闭' },
  'modal.confirm':                { en: 'Confirm',                                                                                    'zh-CN': '确认' },
  'modal.cancel':                 { en: 'Cancel',                                                                                     'zh-CN': '取消' },
  'modal.approval.title':         { en: 'Approve tool call',                                                                          'zh-CN': '批准工具调用' },
  'modal.approval.allow':         { en: 'Approve',                                                                                    'zh-CN': '批准' },
  'modal.approval.deny':          { en: 'Deny',                                                                                       'zh-CN': '拒绝' },
  'modal.approval.always':        { en: 'Approve for session',                                                                        'zh-CN': '会话内始终允许' },
  'modal.approval.allowAlwaysCmd': { en: 'Always allow “{cmd}” (writes a rule to ~/.zhuye/permissions.toml)',  'zh-CN': '始终允许「{cmd}」(写入 ~/.zhuye/permissions.toml 的规则)' },
  'modal.approval.allowAlwaysTool': { en: 'Always allow {tool} (writes a rule to ~/.zhuye/permissions.toml)', 'zh-CN': '始终允许 {tool}(写入 ~/.zhuye/permissions.toml 的规则)' },
  'modal.approval.never':         { en: 'Never allow',                                                                                'zh-CN': '永不允放' },
  'modal.approvalHistory.title':  { en: 'Approval history',                                                                           'zh-CN': '权限历史' },
  'modal.approvalHistory.empty':  { en: 'No approvals yet.',                                                                          'zh-CN': '暂无权限记录。' },
  'modal.submit':                 { en: 'Submit',                                                                                     'zh-CN': '提交' },
  'modal.question.title':         { en: 'Question',                                                                                   'zh-CN': '问题' },
  'modal.question.empty':         { en: '(empty question payload)',                                                                   'zh-CN': '(空问题载荷)' },
  'modal.question.fallback':      { en: 'Question {n}',                                                                               'zh-CN': '问题 {n}' },
  'modal.question.option':        { en: 'Option {n}',                                                                                 'zh-CN': '选项 {n}' },
  'modal.question.other':         { en: 'Other (optional)',                                                                           'zh-CN': '其他（可选）' },
  // 计划审批不再走弹窗：条目见 plan.bar.* / plan.card.*（composer 审批条 +
  // 右 dock 计划页签）。保留失败提示文案（approvePlan 的 toast 用）。
  'modal.planRequest.failed':     { en: 'Plan decision failed: {msg}',                                                 'zh-CN': '计划决策提交失败：{msg}' },
  'modal.askUser.title':          { en: 'Input requested',                                                                            'zh-CN': '需要输入' },
  'modal.askUser.defaultPrompt':  { en: 'The agent needs your input:',                                                                'zh-CN': 'Agent 需要你的输入:' },
  'modal.askUser.placeholder':    { en: 'Type here...',                                                                               'zh-CN': '在此输入…' },
  'modal.approval.toolTitle':     { en: 'Tool Approval',                                                                              'zh-CN': '工具审批' },
  'modal.approval.hookTitle':     { en: 'Hook Approval',                                                                              'zh-CN': '钩子审批' },
  'modal.approval.planTitle':     { en: 'Plan Approval',                                                                              'zh-CN': '计划审批' },
  'modal.approval.risk':                                            { en: 'risk: {risk}',                                                                                                                                                      'zh-CN': '风险: {risk}' },
  'modal.approval.neverAgain':                                      { en: 'Deny and never ask again this session',                                                                                                                              'zh-CN': '拒绝且本会话不再询问' },
  'modal.approval.hint':          { en: 'Approve runs this action once. Approve for session skips future prompts of the same kind.',  'zh-CN': '「批准」运行一次操作。「会话内始终允许」则会跳过同类型后续提示。' },
};

export default modal;
