/**
 * i18n 命名空间 —— usage.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const usage: Record<string, StringEntry> = {
  'usage.title':          { en: 'Usage',                                                     'zh-CN': '用量' },
  'usage.subtitle':       { en: 'Model-level token usage read from ~/.reflect/sessions. Mirrors `reflect session stats` CLI.', 'zh-CN': '从 ~/.reflect/sessions 读取的模型级 token 用量，对应 `reflect session stats` CLI。' },
  'usage.refresh':        { en: 'Refresh',                                                   'zh-CN': '刷新' },
  'usage.currentSession': { en: 'Current session',                                           'zh-CN': '当前会话' },
  'usage.noSession':      { en: 'No session bound yet',                                     'zh-CN': '尚未绑定会话' },
  'usage.noSessionHint':  { en: 'Open a chat to see per-session usage.',                     'zh-CN': '打开一个会话以查看单会话用量。' },
  'usage.noStats':        { en: 'No usage recorded for this session yet',                   'zh-CN': '该会话暂无用量记录' },
  'usage.messages':       { en: 'Messages',                                                  'zh-CN': '消息数' },
  'usage.toolCalls':      { en: 'Tool calls',                                                'zh-CN': '工具调用' },
  'usage.input':          { en: 'Input',                                                     'zh-CN': '输入' },
  'usage.output':         { en: 'Output',                                                    'zh-CN': '输出' },
  'usage.cached':         { en: 'Cached',                                                    'zh-CN': '缓存命中' },
  'usage.total':          { en: 'Total',                                                     'zh-CN': '合计' },
  'usage.cost':           { en: 'Cost',                                                      'zh-CN': '费用' },
  'usage.cacheHitRate':   { en: 'Cache hit rate',                                            'zh-CN': '缓存命中率' },
  'usage.compactions':    { en: 'Compactions',                                               'zh-CN': '压缩次数' },
  'usage.tokensSaved':    { en: 'Tokens saved',                                              'zh-CN': '节省 token' },
  'usage.memoryAccess':   { en: 'Memory access',                                             'zh-CN': '记忆访问' },
  'usage.memoryReads':    { en: 'Reads',                                                     'zh-CN': '读取' },
  'usage.memoryWrites':   { en: 'Writes',                                                    'zh-CN': '写入' },
  'usage.perModel':       { en: 'Per model',                                                 'zh-CN': '按模型' },
  'usage.allSessions':    { en: 'All sessions',                                              'zh-CN': '全部会话' },
  'usage.model':          { en: 'Model',                                                     'zh-CN': '模型' },
  'usage.provider':       { en: 'Provider',                                                  'zh-CN': '供应商' },
  'usage.calls':          { en: 'Calls',                                                     'zh-CN': '调用数' },
  'usage.empty':          { en: 'No usage yet',                                              'zh-CN': '暂无用量' },
  'usage.emptyHint':      { en: 'Usage appears after the first model call.',                 'zh-CN': '首次模型调用后即会出现用量。' },
  // 实时(本次会话进行中)与费率卡
  'usage.live':           { en: 'Live (this session)',                                      'zh-CN': '实时（本次会话）' },
  'usage.liveHint':       { en: 'Accumulated from live token_count events since the session started.', 'zh-CN': '自本次会话开始，由实时 token_count 事件累计。' },
  'usage.liveEmpty':      { en: 'No live usage yet',                                        'zh-CN': '暂无实时用量' },
  'usage.liveEmptyHint':  { en: 'Live usage appears after the first model call in this session.', 'zh-CN': '本次会话的首次模型调用后即会出现实时用量。' },
  'usage.rates':          { en: 'Rates',                                                     'zh-CN': '费率' },
  'usage.ratesHint':      { en: 'USD per 1M tokens, read from the core pricing table. Models not in the table are not billed.', 'zh-CN': '每 1M token 的 USD 价格，取自核心费率表；不在表内的模型不计费。' },
  'usage.rateInput':      { en: 'Input',                                                     'zh-CN': '输入' },
  'usage.rateOutput':     { en: 'Output',                                                    'zh-CN': '输出' },
  'usage.rateCacheRead':  { en: 'Cache read',                                                'zh-CN': '缓存读' },
  'usage.rateCacheWrite': { en: 'Cache write',                                               'zh-CN': '缓存写' },
  'usage.notPriced':      { en: 'Not priced (local or unknown model)',                      'zh-CN': '无价目（本地或未知模型）' },
};

export default usage;
