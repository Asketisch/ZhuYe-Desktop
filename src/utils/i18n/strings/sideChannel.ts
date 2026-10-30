/**
 * i18n 命名空间 - side-channel.*
 */
import type { StringEntry } from '../types';

const sideChannel: Record<string, StringEntry> = {
  'sideChannel.title':                { en: 'Side-channels', 'zh-CN': '侧通道' },
  'sideChannel.subtitle':             { en: 'Manage side-channel registry entries.', 'zh-CN': '管理侧通道注册条目。' },
  'sideChannel.unavailable':          { en: 'Side-channel execution is not available yet. Creating an entry does not run an agent.', 'zh-CN': '侧通道执行尚未接入。创建条目不会运行 agent。' },
  'sideChannel.runningCount':         { en: '{count} running', 'zh-CN': '{count} 个运行中' },
  'sideChannel.agentNamePlaceholder': { en: 'Agent name (e.g. default, reviewer)', 'zh-CN': 'Agent 名称 (如 default、reviewer)' },
  'sideChannel.promptPlaceholder':    { en: 'Prompt (required)', 'zh-CN': 'Prompt (必填)' },
  'sideChannel.start':                { en: 'Start', 'zh-CN': '启动' },
  'sideChannel.startOne':             { en: 'Start a side-channel', 'zh-CN': '启动侧通道' },
  'sideChannel.failed':               { en: 'Failed to load side-channels', 'zh-CN': '加载侧通道失败' },
  'sideChannel.failedDesc':           { en: 'Check the agent backend and try again.', 'zh-CN': '检查 agent 后端并重试。' },
  'sideChannel.empty':                { en: 'No side-channels', 'zh-CN': '暂无侧通道' },
  'sideChannel.emptyDesc':            { en: 'Click “Start a side-channel” above to spawn one.', 'zh-CN': '点击上方的「启动侧通道」创建一个。' },
  'sideChannel.toastStarted':         { en: 'Side-channel entry created: {id}', 'zh-CN': '侧通道条目已创建: {id}' },
  'sideChannel.toastCancelled':       { en: 'Cancelled {id}', 'zh-CN': '已取消 {id}' },
  'sideChannel.toastAlreadyFinished': { en: '{id} is already finished or unknown', 'zh-CN': '{id} 已结束或不存在' },
  'sideChannel.errorNameRequired':    { en: 'Agent name is required.', 'zh-CN': 'Agent 名称必填。' },
  'sideChannel.errorPromptRequired':  { en: 'Prompt is required.', 'zh-CN': 'Prompt 必填。' },
  'sideChannel.errorStart':           { en: 'Start failed: {message}', 'zh-CN': '启动失败: {message}' },
  'sideChannel.errorCancel':          { en: 'Cancel failed: {message}', 'zh-CN': '取消失败: {message}' },
} as const;

export default sideChannel;
