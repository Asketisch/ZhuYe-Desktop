/**
 * F50:live 预览端口扫描 IPC 包装。
 *
 * 后端 `reflect_scan_local_ports` 对 127.0.0.1 做 TCP connect 探测
 * (仅回环),返回各端口 open 状态与 URL —— agent 起完 dev server 后
 * 用户不再猜端口。
 */
import { invoke } from '../bridge';

export interface PortProbe {
  port: number;
  open: boolean;
  url: string;
}

/**
 * 扫描本地 live 端口。
 * `ports` 缺省探测 dev 常用集;`recentOutput` 提供时从中提取 agent
 * 最近提到的端口一并探测。
 */
export async function reflect_scan_local_ports(
  ports?: number[],
  recentOutput?: string,
): Promise<PortProbe[]> {
  return invoke<PortProbe[]>('reflect_scan_local_ports', {
    ports: ports ?? null,
    recentOutput: recentOutput ?? null,
  });
}
