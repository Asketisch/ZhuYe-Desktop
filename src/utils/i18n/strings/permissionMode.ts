/**
 * i18n 命名空间 —— permissionMode.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const permissionMode: Record<string, StringEntry> = {
  'permissionMode.auto.name':     { en: 'auto',                                             'zh-CN': 'auto' },
  'permissionMode.auto.desc':     { en: 'Default: auto-approve file edits; other tools follow rules, high-risk still asks.', 'zh-CN': '默认档:自动批准文件编辑;其他工具按规则放行,高危仍需确认。' },
  'permissionMode.prompt.name':   { en: 'prompt',                                           'zh-CN': 'prompt' },
  'permissionMode.prompt.desc':   { en: 'Ask before each tool call. Recommended.',          'zh-CN': '每次调用工具前询问。推荐设置。' },
  // 以下三档已弃用(仅旧会话回显兼容,不再提供 UI 入口):
  // deny → 拒绝走权限规则/回合级 ApprovalPolicy::deny;
  // accept_edits → 语义并入默认档 auto;bubble → 免打扰走审批策略
  // auto_approve/full_access。
  'permissionMode.deny.name':     { en: 'deny',                                             'zh-CN': 'deny' },
  'permissionMode.deny.desc':     { en: 'Block all tool execution. Read-only chat.',        'zh-CN': '禁止所有工具执行。只读对话。' },
  'permissionMode.plan.name':     { en: 'plan',                                             'zh-CN': 'plan' },
  'permissionMode.plan.desc':     { en: 'Only plan, never execute. Explore safely.',        'zh-CN': '仅规划,从不执行。安全探索。' },
  'permissionMode.accept_edits.name': { en: 'accept_edits',                                   'zh-CN': 'accept_edits' },
  'permissionMode.accept_edits.desc': { en: 'Auto-approve file edits/writes. Other tools still require approval.', 'zh-CN': '自动批准文件编辑/写入。其他工具仍需审批。' },
  'permissionMode.bubble.name':     { en: 'bubble',                                         'zh-CN': 'bubble' },
  'permissionMode.bubble.desc':      { en: 'Auto-approve tools with non-blocking notices; high-risk ops still confirm.', 'zh-CN': '自动批准工具调用（气泡通知不打断）；高危操作仍需确认。' },
  // bypass 不再提供 UI 入口：core v1.3 安全基线把 SetPermissionMode(Bypass)
  // 一律降级 Prompt（协议枚举仅为旧配置序列化兼容保留）。
};

export default permissionMode;
