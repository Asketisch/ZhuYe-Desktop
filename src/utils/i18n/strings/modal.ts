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
  'modal.planRequest.title':      { en: 'Enter plan mode?',                                                                           'zh-CN': '进入计划模式？' },
  'modal.planRequest.approve':    { en: 'Enter plan mode',                                                                            'zh-CN': '进入计划模式' },
  'modal.planRequest.decline':    { en: 'Not now',                                                                                    'zh-CN': '暂不进入' },
  'modal.askUser.title':          { en: 'Input requested',                                                                            'zh-CN': '需要输入' },
  'modal.askUser.defaultPrompt':  { en: 'The agent needs your input:',                                                                'zh-CN': 'Agent 需要你的输入:' },
  'modal.askUser.placeholder':    { en: 'Type here...',                                                                               'zh-CN': '在此输入…' },
  'modal.approval.toolTitle':     { en: 'Tool Approval',                                                                              'zh-CN': '工具审批' },
  'modal.approval.hookTitle':     { en: 'Hook Approval',                                                                              'zh-CN': '钩子审批' },
  'modal.approval.planTitle':     { en: 'Plan Approval',                                                                              'zh-CN': '计划审批' },
  'modal.approval.hint':          { en: 'Approve runs this action once. Approve for session skips future prompts of the same kind.',  'zh-CN': '「批准」运行一次操作。「会话内始终允许」则会跳过同类型后续提示。' },
  'modal.planReady.title':        { en: 'Plan Ready',                                                                                 'zh-CN': '计划已就绪' },
  'modal.planReady.approve':      { en: 'Approve plan',                                                                               'zh-CN': '批准计划' },
  'modal.planReady.reject':       { en: 'Revise',                                                                                     'zh-CN': '修改计划' },
  'modal.planReady.hint':         { en: 'Approve lets the agent execute the plan; Revise keeps plan mode open for feedback.',         'zh-CN': '「批准」让 agent 执行计划；「修改计划」保留计划模式以便反馈。' },
  'modal.planReady.manualApprove':{ en: 'Manual Approve',                                                                             'zh-CN': '手动审批' },
};

export default modal;
