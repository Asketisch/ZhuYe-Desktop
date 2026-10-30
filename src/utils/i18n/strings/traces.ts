/**
 * i18n 命名空间 —— traces.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const traces: Record<string, StringEntry> = {
  'traces.title':        { en: 'LLM Traces',                                            'zh-CN': '模型调用记录' },
  'traces.subtitle':     { en: 'Local model-io records under ~/.zhuye/traces (redacted). Mirrors the `zhuye traces` CLI.', 'zh-CN': '~/.zhuye/traces 下的本地模型调用记录（已脱敏），对应 `zhuye traces` CLI。' },
  'traces.refresh':      { en: 'Refresh',                                               'zh-CN': '刷新' },
  'traces.sessionList':  { en: 'Sessions',                                              'zh-CN': '会话' },
  'traces.empty':        { en: 'No traces yet',                                         'zh-CN': '暂无调用记录' },
  'traces.emptyHint':    { en: 'Records appear after the first LLM call in a session.', 'zh-CN': '会话中的首次模型调用后即会出现记录。' },
  'traces.selectPrompt': { en: 'Select a session to view its LLM calls',                'zh-CN': '选择会话以查看其模型调用' },
  'traces.detailTitle':  { en: 'Call details',                                          'zh-CN': '调用详情' },
  'traces.callsUnit':    { en: 'calls',                                                 'zh-CN': '次' },
  'traces.loading':      { en: 'Loading…',                                              'zh-CN': '加载中…' },
  'traces.usageTitle':   { en: 'Token usage (in / out / cost)',                         'zh-CN': 'token 用量（入 / 出 / 成本）' },
  // Span 日志(turn → model → tool 父子链)
  'traces.tabs':         { en: 'Trace views',                                            'zh-CN': '调用记录视图' },
  'traces.tab.calls':    { en: 'Model calls',                                            'zh-CN': '模型调用' },
  'traces.tab.spans':    { en: 'Span tree',                                              'zh-CN': 'Span 树' },
  'traces.spans.day':    { en: 'Day',                                                    'zh-CN': '日期' },
  'traces.spans.noFiles':{ en: 'No span log files',                                      'zh-CN': '暂无 span 日志文件' },
  'traces.spans.empty':  { en: 'No spans for this day',                                 'zh-CN': '该日无 span 记录' },
  'traces.spans.emptyHint': { en: 'Spans appear after telemetry is enabled and a turn runs.', 'zh-CN': '开启 telemetry 并跑过一轮后即会出现 span 记录。' },
};

export default traces;
