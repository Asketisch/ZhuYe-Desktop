/**
 * 审批弹窗的「始终允许」规则推导。
 *
 * 纯函数 —— 从一次待审批的工具调用推导出「要写进核心权限层的 allow
 * 规则」。写进的是**核心的用户级权限文件**
 * (`~/.reflect/permissions.toml`,CLI 与 GUI 共用),落盘后立即生效
 * (核心的 `StorePermissionResolver` 每次评估都重读文件),并在
 * Settings → Permissions 的「生效的权限规则」里可见 —— 真值唯一。
 *
 * ## 授权范围刻意保守
 *
 * - **Bash** → 规则是**整条命令**(`shell_pattern = "<完整命令>"`),
 *   不是「命令首词 + 通配」。`git *` 这类前缀会把 `rm`/`curl|sh` 之类
 *   一起放行,风险太大;整条命令是精确匹配,范围最小。
 * - **只读工具**(read / grep / glob)→ 整个工具放行(无副作用)。
 * - **写类工具**(write / edit / delete / notebook / web_fetch)→ **不给**
 *   「始终允许」按钮:核心的规则模型没有路径维度,放行整个写工具等于
 *   把「AcceptEdits」模式一次性打开,不该由一次点击顺手做掉。
 */
import type { PermissionRuleInput } from '@/utils/commands';

/** 放行整个工具是安全的只读工具。 */
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob']);

/** 提取工具调用里的命令文本(Bash 工具的 `cmd` 参数)。 */
export function extractCommand(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const cmd = (args as { cmd?: unknown }).cmd;
  if (typeof cmd !== 'string') return null;
  const trimmed = cmd.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 从一次工具审批推导 allow 规则;推不出来时返回 `null`
 * (调用方据此不显示「始终允许」按钮)。
 */
export function deriveAllowRule(
  toolName: string | undefined,
  args: unknown,
): PermissionRuleInput | null {
  if (!toolName) return null;
  const tool = toolName.trim();
  if (!tool) return null;
  const lower = tool.toLowerCase();

  if (lower === 'bash') {
    const cmd = extractCommand(args);
    if (!cmd) return null;
    return {
      tool: 'Bash',
      action: 'allow',
      toolGlob: null,
      // 整条命令精确匹配(core 的 shell_pattern 是 glob,无通配符 = 精确)。
      shellPattern: cmd,
    };
  }

  if (READ_ONLY_TOOLS.has(lower)) {
    return { tool, action: 'allow', toolGlob: null, shellPattern: null };
  }

  return null;
}
