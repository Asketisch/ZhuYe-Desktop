/**
 * 外部 Agent 导入(v1.11 D9)—— Claude Code / Codex / ZCode 会话 → 烛夜。
 *
 * 后端 `reflect_import_discover` / `reflect_import_sessions` 直接驱动
 * `reflect-import` 引擎(发现来源 → 批量导入到本机 rollout base)。
 */
import { invoke } from '../bridge';

/** 支持的 Harness 种类。 */
export type ImportHarnessKind = 'claude_code' | 'codex' | 'zcode';

/** 一条可导入来源。 */
export interface ReflectImportSourceInfo {
  display: string;
}

/** 一条导入成功的统计。 */
export interface ReflectImportOutcome {
  source: string;
  threadId: string;
  turns: number;
  records: number;
  path: string | null;
  warnings: string[];
}

/** 一条导入失败。 */
export interface ReflectImportFailure {
  source: string;
  error: string;
}

/** 批量导入结果。 */
export interface ReflectImportRunResult {
  imported: ReflectImportOutcome[];
  failed: ReflectImportFailure[];
}

/** 按种类列出可导入来源(只发现,不入库)。 */
export async function reflect_import_discover(
  kind: ImportHarnessKind,
): Promise<ReflectImportSourceInfo[]> {
  return invoke<ReflectImportSourceInfo[]>('reflect_import_discover', { kind });
}

/**
 * 批量导入某类 Harness 的会话。`dryRun = true` 只解析统计、不写文件。
 * 单源失败不中断整批(失败清单逐条返回)。
 */
export async function reflect_import_sessions(
  kind: ImportHarnessKind,
  opts: {
    force?: boolean;
    dryRun?: boolean;
    includeThinking?: boolean;
    keepInjected?: boolean;
  } = {},
): Promise<ReflectImportRunResult> {
  return invoke<ReflectImportRunResult>('reflect_import_sessions', {
    kind,
    force: opts.force ?? false,
    dryRun: opts.dryRun ?? false,
    includeThinking: opts.includeThinking ?? false,
    keepInjected: opts.keepInjected ?? false,
  });
}
