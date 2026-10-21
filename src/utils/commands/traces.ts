/**
 * Traces(LLM 调用记录)IPC 包装。
 *
 * 薄包装 `reflect_list_traces` / `reflect_get_trace` 两个命令,对应
 * CLI `reflect traces ls / show`。类型与后端
 * `reflect_app_core::traces::{TraceSessionSummary, TraceCall}` 的
 * camelCase 出线对齐。
 */
import { invoke } from '@/utils/bridge';

/** 一个 session 的 traces 摘要。 */
export interface TraceSessionSummary {
  /** session id(ThreadId uuid)。 */
  sessionId: string;
  /** 可读标题(rollout 名 / id 前 8 字符)。 */
  title: string;
  /** LLM 调用次数。 */
  calls: number;
  /** 最近调用完成时间(RFC3339)。 */
  lastAt: string;
  /** 最近调用的模型 id。 */
  model: string;
  /** 最近调用来源(main_turn / subagent / compact / goal_verification)。 */
  lastSource?: string | null;
}

/** token 用量快照(与 telemetry UsageSnapshot 对齐,snake_case 直传)。 */
export interface TraceUsageSnapshot {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_usd?: number | null;
}

/** 模型引用。 */
export interface TraceModelRef {
  modelId: string;
  providerId?: string | null;
  role?: string | null;
  source?: string | null;
}

/** 单次 LLM 调用详情(已脱敏 + 截断的请求/响应概要)。 */
export interface TraceCall {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  attempt: number;
  requestId: string;
  traceId: string;
  turnId?: string | null;
  querySource: string;
  model: TraceModelRef;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  usage: TraceUsageSnapshot;
}

/** 列出有 LLM 调用记录的 session(按最近降序,默认 20 条)。 */
export function reflect_list_traces(limit?: number): Promise<TraceSessionSummary[]> {
  return invoke('reflect_list_traces', { limit: limit ?? null });
}

/** 展开某 session 的逐条调用详情(id 支持前 8 字符前缀)。 */
export function reflect_get_trace(id: string): Promise<TraceCall[]> {
  return invoke('reflect_get_trace', { id });
}

// ====== Span 日志(turn → model → tool 父子链) ======

/** 一个可用的 span 日志文件(按天)。 */
export interface SpanLogFile {
  /** 日期标识(`2026-10-01`)。 */
  day: string;
  /** 文件绝对路径。 */
  path: string;
}

/** 一条 span 事件。 */
export interface TraceSpan {
  spanId: string;
  parentSpanId?: string | null;
  /** 事件判别器(`turn.started` / `model.request.completed` / `tool.call.ended` …)。 */
  event: string;
  /** 发射模块(`reflect_core::submission_loop` / `reflect_goal` …)。 */
  module: string;
  /** 日志级别。 */
  level: string;
  /** span 状态(started / completed / failed)。 */
  status?: string | null;
  turnId?: string | null;
  toolCallId?: string | null;
  sessionId?: string | null;
  /** 耗时(毫秒)。 */
  durationMs?: number | null;
  /** 时间戳(RFC3339)。 */
  timestamp: string;
  /** 事件特定 payload(已脱敏)。 */
  context?: unknown;
  /** 树深度(0 = 根),供缩进渲染。 */
  depth: number;
}

/** 列出最近若干天的 span 日志文件(最近在前)。 */
export function reflect_list_span_logs(days?: number): Promise<SpanLogFile[]> {
  return invoke('reflect_list_span_logs', { days: days ?? null });
}

/**
 * 读取某天 span 日志的事件(按父子关系算好树深度)。
 *
 * `sessionId` 缺省 = 读该天全部事件。
 */
export function reflect_read_span_log(
  day: string,
  sessionId?: string | null,
): Promise<TraceSpan[]> {
  return invoke('reflect_read_span_log', { day, sessionId: sessionId ?? null });
}
