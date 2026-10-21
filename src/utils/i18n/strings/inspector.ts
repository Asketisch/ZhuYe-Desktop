/**
 * i18n 命名空间 —— inspector.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const inspector: Record<string, StringEntry> = {
  'inspector.title':             { en: 'Inspector',                   'zh-CN': '检查器' },
  'inspector.pending':           { en: 'Pending',                     'zh-CN': '待处理' },
  'inspector.pendingEmpty':      { en: 'No pending interactions.',    'zh-CN': '没有待处理交互。' },
  'inspector.pendingApprovals':  { en: 'Approvals',                   'zh-CN': '权限' },
  'inspector.pendingQuestions':  { en: 'Questions',                   'zh-CN': '问题' },
  'inspector.pendingInputs':     { en: 'Inputs',                      'zh-CN': '输入' },
  'inspector.mcpServers':        { en: 'MCP servers',                 'zh-CN': 'MCP 服务' },
  'inspector.mcpEmpty':          { en: 'No MCP servers configured.',  'zh-CN': '未配置 MCP 服务。' },
  'inspector.lspServers':        { en: 'LSP servers',                 'zh-CN': 'LSP 服务' },
  'inspector.lspEmpty':          { en: 'No LSP servers configured.',  'zh-CN': '未配置 LSP 服务。' },

  // ===== 子代理可观测（v1.4 C1:progress 推送 + 状态查询）=====
  'inspector.subagents':             { en: 'Subagents',                'zh-CN': '子代理' },
  'inspector.subagents.refresh':     { en: 'Refresh subagent status',  'zh-CN': '刷新子代理状态' },
  'inspector.subagents.none':        { en: 'No matching subagents.',   'zh-CN': '没有匹配的子代理。' },
  'inspector.subagents.kindMessage': { en: 'message',                  'zh-CN': '消息' },
  'inspector.subagents.kindToolBegin': { en: 'tool start',             'zh-CN': '工具开始' },
  'inspector.subagents.kindToolEnd': { en: 'tool end',                 'zh-CN': '工具结束' },
  'inspector.lastError':         { en: 'Last error',                  'zh-CN': '最近错误' },
  'inspector.dismiss':           { en: 'Dismiss',                     'zh-CN': '忽略' },

  // ===== agent 的 todo 清单(来自 `TodoWrite` 工具输出元数据)=====
  'inspector.todoList':          { en: 'Todo list',                   'zh-CN': 'Todo 清单' },

  // ===== Token usage（最近一次 token_count 事件的快照）=====
  'inspector.tokenUsage':        { en: 'Token usage',                 'zh-CN': 'Token 用量' },
  'inspector.tokenEmpty':        { en: 'No token data yet.',          'zh-CN': '暂无 token 数据。' },
  'inspector.tokenInput':        { en: 'Input',                       'zh-CN': '输入' },
  'inspector.tokenOutput':       { en: 'Output',                      'zh-CN': '输出' },
  'inspector.tokenCached':       { en: 'Cached',                      'zh-CN': '缓存命中' },
  'inspector.tokenCachedHint':   { en: 'cache_read — subset of input','zh-CN': 'cache_read —— 输入的子集' },
  'inspector.tokenCacheWrite':   { en: 'Cache write',                 'zh-CN': '缓存写入' },
  'inspector.tokenCacheWriteHint': { en: 'cache_creation — subset of input, not added to total', 'zh-CN': 'cache_creation —— 输入的子集,不计入 total' },
  'inspector.tokenTotal':        { en: 'Total',                       'zh-CN': '合计' },
  'inspector.tokenProvider':     { en: 'Provider',                    'zh-CN': '提供商' },
  'inspector.tokenCredential':   { en: 'Credential',                  'zh-CN': '凭据' },
  'inspector.tokenModel':        { en: 'Model',                       'zh-CN': '模型' },
  'inspector.byModel':           { en: 'By model (session total)',    'zh-CN': '按模型（会话累计）' },
  'inspector.callsUnit':         { en: 'calls',                      'zh-CN': '次调用' },
  'inspector.compactionsDetail': { en: 'Per-compaction detail',      'zh-CN': '逐次压缩明细' },
  // 运行时状态(凭证池 / 已完成的子代理调用)
  'inspector.credentialPool':     { en: 'Credential pool',             'zh-CN': '凭证池' },
  'inspector.credentialPoolOk':   { en: 'all healthy',                 'zh-CN': '全部健康' },
  'inspector.credentialPoolCooling': { en: '{count} cooling',          'zh-CN': '{count} 个冷却中' },
  'inspector.subagentCalls':      { en: 'Completed subagent calls',    'zh-CN': '已完成的子代理调用' },
  'inspector.contextWindow':     { en: 'Context window: {tokens} tokens', 'zh-CN': '上下文窗口: {tokens} tokens' },

  // ===== v1.x P2：概览 / 文件 / 改动 三 tab =====
  'inspector.tab.overview':      { en: 'Overview',                    'zh-CN': '概览' },
  'inspector.tab.files':         { en: 'Files',                       'zh-CN': '文件' },
  'inspector.tab.changes':       { en: 'Changes',                     'zh-CN': '改动' },
  'inspector.contextGauge':      { en: 'Context window',              'zh-CN': '上下文窗口' },
  'inspector.contextEmpty':      { en: 'No context usage reported yet.', 'zh-CN': '尚未上报上下文用量。' },
  'inspector.compactions':       { en: 'Context compactions',         'zh-CN': '上下文压缩' },
  'inspector.compactionsSaved':  { en: 'Tokens saved by pruning',     'zh-CN': '压缩节省 tokens' },
  'inspector.sessionMetrics':    { en: 'Session metrics',             'zh-CN': '会话指标' },
  'inspector.metricTurns':       { en: 'Turns',                       'zh-CN': '轮数' },
  'inspector.metricTotalTokens': { en: 'Total tokens',                'zh-CN': '累计 tokens' },
  'inspector.comp.input':        { en: 'Input',                       'zh-CN': '提示词' },
  'inspector.comp.cached':       { en: 'Cache hit',                   'zh-CN': '缓存命中' },
  'inspector.comp.cacheWrite':   { en: 'Cache write',                 'zh-CN': '缓存写入' },
  'inspector.comp.output':       { en: 'Output',                      'zh-CN': '回复' },
  'inspector.filesEmpty':        { en: 'No workspace open (or empty).', 'zh-CN': '未打开工作区（或目录为空）。' },
};

export default inspector;
