/**
 * OS 沙箱状态 IPC 包装。
 *
 * 报的是**有效状态** —— 与工具实际使用的构造器
 * (`OsSandbox::with_enabled(enabled)`)同源,因此状态栏显示的与 bash
 * 实际跑在哪个沙箱里一致。
 */
import { invoke } from '../bridge';

/** 沙箱状态。 */
export interface SandboxStatus {
  /** 配置里的 `[sandbox].os_level` 值(未表态时已归一为基线开启)。 */
  osLevel: boolean;
  /** 有效状态:`disabled` / `seatbelt` / `landlock` / `no_backend`。 */
  status: string;
  /** 沙箱是否真的在生效。 */
  active: boolean;
  /** 平台可用后端:`seatbelt` / `landlock` / `none`。 */
  backend: string;
  /** 核心给出的状态描述(一行,用于 tooltip)。 */
  statusLine: string;
  /** 生效开关(env 优先;未设置 env 时 = `osLevel`)。 */
  enabled: boolean;
  /** 进程 env `ZHUYE_SANDBOX_OS_LEVEL` 的原始值(若用户显式设过)。 */
  envOverride: string | null;
}

/** 查询当前生效的 OS 沙箱状态。 */
export function reflect_sandbox_status(): Promise<SandboxStatus> {
  return invoke('reflect_sandbox_status');
}
