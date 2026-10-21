/**
 * DAG 流水线 IPC 包装。
 *
 * 薄包装 `reflect_run_team_pipeline` / `reflect_run_pipeline` 两个命令,
 * 对应 CLI `reflect pipeline team / run`。`PipelineReport` 为 submodule
 * 类型直传(snake_case,与 CLI `--output` JSON 同构)。
 *
 * 另含**配置编辑**面(校验 / 列表 / 落盘)—— 此前 GUI 只能跑一个已有的
 * TOML 文件(还得手写),新增拓扑只能靠手改文件 + 跑失败才知道写错了。
 */
import { invoke } from '@/utils/bridge';

/** 单节点执行报告(snake_case 直传 submodule `NodeReport`)。 */
export interface PipelineNodeReport {
  name: string;
  status: 'Success' | 'Skipped' | 'Failed' | string;
  outputs: Record<string, unknown>;
  error?: string;
  elapsed_ms: number;
  started_at_ms: number;
}

/** 流水线整体执行报告。 */
export interface PipelineReport {
  topic: string;
  status: 'success' | 'partial' | 'failed' | string;
  failure_policy: string;
  nodes: PipelineNodeReport[];
  total_elapsed_ms: number;
}

/** 用已注册 team 跑四阶段预设 pipeline(plan → prd → exec → verify)。 */
export function reflect_run_team_pipeline(
  teamName: string,
  topic: string,
): Promise<PipelineReport> {
  return invoke('reflect_run_team_pipeline', { teamName, topic });
}

/**
 * 读 TOML DAG 配置跑任意拓扑。
 *
 * `failurePolicy`:`'abort' | 'continue_collect'`(可选);
 * `inputs`:模板 `{{input.<key>}}` 引用的自定义输入。
 */
export function reflect_run_pipeline(
  configPath: string,
  topic: string,
  failurePolicy?: string,
  inputs?: Record<string, string>,
): Promise<PipelineReport> {
  return invoke('reflect_run_pipeline', {
    configPath,
    topic,
    failurePolicy: failurePolicy ?? null,
    inputs: inputs ?? null,
  });
}

// ====== 配置编辑(校验 / 列表 / 落盘) ======

/** pipeline TOML 校验结果。 */
export interface PipelineConfigSummary {
  /** 流水线名。 */
  name: string;
  /** 失败策略(缺省 `abort`)。 */
  failurePolicy: string;
  /** 节点标签列表(按字典序)。 */
  nodes: string[];
  /** 节点总数。 */
  nodeCount: number;
  /** `runner = "team"` 但 team 未注册的节点标签。 */
  missingTeams: string[];
  /** 校验是否通过。 */
  valid: boolean;
  /** 校验错误文本(不通过时给出核心的错误)。 */
  error?: string | null;
}

/** 一个已保存的 pipeline 配置。 */
export interface PipelineConfigFile {
  /** 配置名(文件名去扩展名)。 */
  name: string;
  /** 文件绝对路径。 */
  path: string;
  /** 文件内容(TOML 原文)。 */
  toml: string;
}

/**
 * 校验一段 pipeline TOML。
 *
 * 校验走核心的 `Pipeline::from_toml`(与实际运行同一条路径)——
 * 配置级 + wiring 级错误都如实返回。
 */
export function reflect_validate_pipeline(
  tomlSrc: string,
): Promise<PipelineConfigSummary> {
  return invoke('reflect_validate_pipeline', { tomlSrc });
}

/** 列出已保存的 pipeline 配置(`~/.reflect/pipelines/*.toml`)。 */
export function reflect_list_pipeline_configs(): Promise<PipelineConfigFile[]> {
  return invoke('reflect_list_pipeline_configs');
}

/**
 * 保存一个 pipeline 配置(写到 `~/.reflect/pipelines/<name>.toml`)。
 *
 * 写前由后端跑一次核心校验 —— 非法配置**不落盘**。
 */
export function reflect_save_pipeline_config(
  name: string,
  tomlSrc: string,
): Promise<PipelineConfigFile> {
  return invoke('reflect_save_pipeline_config', { name, tomlSrc });
}
