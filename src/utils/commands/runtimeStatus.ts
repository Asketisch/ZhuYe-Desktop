/**
 * 运行时状态 IPC 包装 —— 「系统此刻到底怎么了」的可观测面。
 *
 * 这些能力基座都有、GUI 此前一个都看不到:
 * - 凭证池健康度(failover 后看不出哪个凭证在冷却);
 * - 已完成的子代理调用(压缩后答不出「刚才派了哪些子代理」);
 * - 记忆分段(agent 实际注入的是切分 + 筛选后的条目,不是整份原文);
 * - 配置位置与分析健康度(手改 config.toml 后不知道应用读的是哪个文件)。
 */
import { invoke } from '../bridge';

/** 单个 provider 的凭证池健康度。 */
export interface CredentialPoolStatus {
  provider: string;
  /** 池内凭证总数(含顶层 `api_key` 的隐式条目)。 */
  total: number;
  /** 当前未处于冷却的凭证数。 */
  healthy: number;
  /** 健康凭证的 label 列表。 */
  healthyLabels: string[];
}

/** 一条已完成的子代理调用。 */
export interface SubagentCallRecord {
  /** 工具名(`call_<role>`)。 */
  toolName: string;
  taskSummary: string;
  resultSummary: string;
  iteration: number;
  createdAt: string;
}

/** 记忆的一个分段。 */
export interface MemorySectionInfo {
  scope: string;
  /** `## ` 标题;无标题条目为空串。 */
  title: string;
  body: string;
  /** 文件内序号(0-based)。 */
  index: number;
  /** 正文字符数(与 8000 字注入预算对照)。 */
  chars: number;
}

/** 配置文件与分析上报的状态。 */
export interface ConfigInfo {
  /** 配置文件绝对路径;HOME 缺失时为 null。 */
  path?: string | null;
  /** 配置文件是否实际存在。 */
  exists: boolean;
  analyticsEnabled: boolean;
  analyticsStatus: string;
  workspace: string;
  activeAgent: string;
}

/** 查询各 provider 的凭证池健康度。 */
export function reflect_credential_pool_status(): Promise<CredentialPoolStatus[]> {
  return invoke('reflect_credential_pool_status');
}

/** 查询本会话已完成的子代理调用。 */
export function reflect_recovery_state(): Promise<SubagentCallRecord[]> {
  return invoke('reflect_recovery_state');
}

/** 查询记忆的分段视图(与 agent 实际注入的结构一致)。 */
export function reflect_memory_sections(): Promise<MemorySectionInfo[]> {
  return invoke('reflect_memory_sections');
}

/** 查询配置位置与分析健康度。 */
export function reflect_config_info(): Promise<ConfigInfo> {
  return invoke('reflect_config_info');
}
