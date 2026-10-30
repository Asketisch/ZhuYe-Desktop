/**
 * i18n 命名空间 - schedule.*
 */
import type { StringEntry } from '../types';

const schedule: Record<string, StringEntry> = {
  'schedule.title':                { en: 'Schedule',             'zh-CN': '定时任务' },
  'schedule.subtitle':            { en: 'Cron-driven autonomous triggers. Due jobs fire their prompt into the agent loop.', 'zh-CN': '由 cron 驱动的自动触发器。到期任务将 prompt 注入 agent 循环。' },
  'schedule.add':                  { en: 'Add',                  'zh-CN': '添加' },
  'schedule.cancel':               { en: 'Cancel',               'zh-CN': '取消' },
  'schedule.create':               { en: 'Schedule',             'zh-CN': '创建' },
  'schedule.failed':               { en: 'Failed to load schedules', 'zh-CN': '加载定时任务失败' },
  'schedule.failedDesc':          { en: 'Check the agent backend and try again.', 'zh-CN': '检查后端并重试。' },
  'schedule.empty':                { en: 'No scheduled jobs',    'zh-CN': '暂无定时任务' },
  'schedule.emptyDesc':            { en: 'Add a cron job above to trigger the agent on a schedule.', 'zh-CN': '在上方添加 cron 任务以触发 agent。' },
  'schedule.cron':                 { en: 'Schedule (cron: min hour dom month dow, e.g. 0 9 * * 1-5)', 'zh-CN': '计划 (cron: 分 时 日 月 周, 如 0 9 * * 1-5)' },
  'schedule.prompt':               { en: 'Prompt (required)',    'zh-CN': '提示 (必填)' },
  'schedule.name':                 { en: 'Name (optional)',      'zh-CN': '名称 (选填)' },
  'schedule.nextFire':             { en: 'Next fire (local time)', 'zh-CN': '下次触发（本地时间）' },
  'schedule.remove':               { en: 'Remove',               'zh-CN': '移除' },
  'schedule.toggle':               { en: 'toggle',               'zh-CN': '切换' },
  'schedule.enabled':              { en: 'enabled',              'zh-CN': '已启用' },
  'schedule.disabled':             { en: 'disabled',             'zh-CN': '已禁用' },
  'schedule.disable':              { en: 'Disable',              'zh-CN': '禁用' },
  'schedule.enable':               { en: 'Enable',               'zh-CN': '启用' },
  'schedule.active':               { en: 'active',               'zh-CN': '活跃' },
  'schedule.runtimeNotice':        { en: 'Cron expressions use UTC. Jobs are kept in memory and are lost when the app exits.', 'zh-CN': 'Cron 表达式使用 UTC。任务仅保存在内存中，应用退出后会丢失。' },
  'schedule.errorCronRequired':    { en: 'Schedule (cron expression) is required.', 'zh-CN': '请填写 cron 表达式。' },
  'schedule.errorPromptRequired':  { en: 'Prompt is required.', 'zh-CN': '请填写提示。' },
  'schedule.created':              { en: 'Scheduled “{schedule}”', 'zh-CN': '已创建定时任务“{schedule}”' },
  'schedule.createFailed':         { en: 'Schedule failed: {message}', 'zh-CN': '创建定时任务失败：{message}' },
  'schedule.enabledToast':         { en: 'Enabled {name}', 'zh-CN': '已启用 {name}' },
  'schedule.disabledToast':        { en: 'Disabled {name}', 'zh-CN': '已禁用 {name}' },
  'schedule.toggleFailed':         { en: 'Toggle failed: {message}', 'zh-CN': '切换定时任务失败：{message}' },
  'schedule.removed':              { en: 'Removed {name}', 'zh-CN': '已移除 {name}' },
  'schedule.alreadyRemoved':       { en: '{name} was already removed or not found.', 'zh-CN': '{name} 已移除或不存在。' },
  'schedule.removeFailed':         { en: 'Remove failed: {message}', 'zh-CN': '移除定时任务失败：{message}' },
} as const;

export default schedule;
