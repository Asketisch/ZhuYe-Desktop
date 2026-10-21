/**
 * 安全扫描 IPC 包装 —— 一次性跑 `cargo audit`。
 *
 * 核心的 `run_cargo_audit` 是**真实实现**（30s 超时 + 管道排空，IO 错误
 * 落结构化报告而非 panic）。GUI 此前只能自己开终端跑。
 */
import { invoke } from '../bridge';

/** 安全扫描报告。 */
export interface SecurityScanResult {
  /** 是否找到 cargo-audit 并成功执行。 */
  ran: boolean;
  /** 进程 exit code(未运行时 null)。 */
  exitCode?: number | null;
  /** stdout + stderr 合并输出(截断至 64 KiB)。 */
  output: string;
  /** 人类可读摘要。 */
  summary: string;
}

/** 在当前工作区跑一次 `cargo audit`(有界超时,可能耗时数十秒)。 */
export function reflect_run_security_scan(): Promise<SecurityScanResult> {
  return invoke('reflect_run_security_scan');
}
