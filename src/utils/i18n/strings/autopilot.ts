/**
 * i18n 命名空间 - autopilot.*
 */
import type { StringEntry } from '../types';

const autopilot: Record<string, StringEntry> = {
  'autopilot.title':                 { en: 'Autopilot', 'zh-CN': '自动任务' },
  'autopilot.subtitle':              { en: 'Configure automatic task scheduling and view its history.', 'zh-CN': '配置自动任务调度并查看历史记录。' },
  'autopilot.unavailable':           { en: 'Automatic task execution is not available yet. These settings are saved but do not start scheduled tasks.', 'zh-CN': '自动任务执行尚未接入。这些设置会保存，但不会启动定时任务。' },
  'autopilot.configuration':         { en: 'Configuration', 'zh-CN': '配置' },
  'autopilot.enabled':               { en: 'Configured as enabled', 'zh-CN': '配置为启用' },
  'autopilot.disabled':              { en: 'Configured as disabled', 'zh-CN': '配置为禁用' },
  'autopilot.enable':                { en: 'Set enabled in configuration', 'zh-CN': '在配置中设为启用' },
  'autopilot.cronSchedule':          { en: 'Cron schedule', 'zh-CN': 'Cron 计划' },
  'autopilot.cronPlaceholder':       { en: '0 9 * * 1-5 (weekdays at 9am)', 'zh-CN': '0 9 * * 1-5（工作日每天上午 9 点）' },
  'autopilot.taskTemplate':          { en: 'Task template', 'zh-CN': '任务模板' },
  'autopilot.taskTemplatePlaceholder': { en: 'Prompt template for automatically created tasks...', 'zh-CN': '自动创建任务的 Prompt 模板…' },
  'autopilot.agent':                 { en: 'Agent', 'zh-CN': 'Agent' },
  'autopilot.agentPlaceholder':      { en: 'default (optional)', 'zh-CN': 'default（选填）' },
  'autopilot.maxConcurrent':         { en: 'Max concurrent', 'zh-CN': '最大并发' },
  'autopilot.edit':                  { en: 'Edit', 'zh-CN': '编辑' },
  'autopilot.runHistory':            { en: 'Run History', 'zh-CN': '运行历史' },
  'autopilot.noRuns':                { en: 'No runs yet', 'zh-CN': '暂无运行记录' },
  'autopilot.noRunsDesc':            { en: 'No recorded runs are available.', 'zh-CN': '没有可显示的运行记录。' },
  'autopilot.configLoadFailed':      { en: 'Failed to load autopilot configuration.', 'zh-CN': '无法读取自动任务配置。' },
  'autopilot.historyLoadFailed':     { en: 'Failed to load autopilot history.', 'zh-CN': '无法读取自动任务历史。' },
  'autopilot.saveFailed':            { en: 'Failed to save autopilot configuration.', 'zh-CN': '无法保存自动任务配置。' },
} as const;

export default autopilot;
