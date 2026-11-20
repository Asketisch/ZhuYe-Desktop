/**
 * 外部 Agent 导入(v1.11 D9)—— 外部 harness 会话 → 烛夜。
 *
 * 后端 `zhuye_import_discover` / `zhuye_import_sessions` 直接驱动
 * `zhuye-import` 引擎(发现来源 → 批量导入到本机 rollout base)。
 */
import { invoke } from '../bridge';

/** 支持的 Harness 种类。 */
export type ImportHarnessKind = 'claude_code' | 'codex';

/** 一条可导入来源。 */
export interface ZhuyeImportSourceInfo {
  display: string;
}

/** 一条导入成功的统计。 */
export interface ZhuyeImportOutcome {
  source: string;
  threadId: string;
  turns: number;
  records: number;
  path: string | null;
  warnings: string[];
}

/** 一条导入失败。 */
export interface ZhuyeImportFailure {
  source: string;
  error: string;
}

/** 批量导入结果。 */
export interface ZhuyeImportRunResult {
  imported: ZhuyeImportOutcome[];
  failed: ZhuyeImportFailure[];
}

/** 按种类列出可导入来源(只发现,不入库)。 */
export async function zhuye_import_discover(
  kind: ImportHarnessKind,
): Promise<ZhuyeImportSourceInfo[]> {
  return invoke<ZhuyeImportSourceInfo[]>('zhuye_import_discover', { kind });
}

/**
 * 批量导入某类 Harness 的会话。`dryRun = true` 只解析统计、不写文件。
 * 单源失败不中断整批(失败清单逐条返回)。
 */
export async function zhuye_import_sessions(
  kind: ImportHarnessKind,
  opts: {
    force?: boolean;
    dryRun?: boolean;
    includeThinking?: boolean;
    keepInjected?: boolean;
  } = {},
): Promise<ZhuyeImportRunResult> {
  return invoke<ZhuyeImportRunResult>('zhuye_import_sessions', {
    kind,
    force: opts.force ?? false,
    dryRun: opts.dryRun ?? false,
    includeThinking: opts.includeThinking ?? false,
    keepInjected: opts.keepInjected ?? false,
  });
}
