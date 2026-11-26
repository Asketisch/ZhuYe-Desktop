/**
 * 按领域拆分的 IPC 封装 barrel。
 *
 * `src/utils/commands.ts` 保留为公共兼容再导出 —— 新代码推荐直接从
 * `@/utils/commands/{domain}` 导入。
 */
export * from './harness/health';
export * from './orchestration/agent';
export * from './orchestration/approvals';
export * from './orchestration/plan';
export * from './orchestration/goal';
export * from './harness/permissions';
export * from './orchestration/questions';
export * from './harness/config';
export * from './workbench/preview';
export * from './conversation/sessions';
export * from './harness/events';
export * from './conversation/workspaces';
export * from './knowledge/skills';
export * from './knowledge/memory';
export * from './knowledge/models';
export * from './connect/hooks';
export * from './orchestration/tasks';
export * from './orchestration/teams';
export * from './orchestration/schedule';
export * from './orchestration/agents';
export * from './connect/side_channel';
export * from './connect/remote';
export * from './workbench/git';
export * from './workbench/terminal';
export * from './workbench/files';
export * from './harness/allowlist';
export * from './harness/updates';
export * from './workbench/browser';
export * from './workbench/search';
export * from './connect/kms';
export * from './harness/lsp';
export * from './orchestration/autopilot';
export * from './telemetry/activity';
export * from './orchestration/squad';
export * from './telemetry/notifications';
export * from './telemetry/media';
export * from './orchestration/plugins';
export * from './telemetry/traces';
export * from './conversation/discussion';
export * from './orchestration/pipeline';
export * from './knowledge/prompts';
export * from './telemetry/stats';
export * from './conversation/notes';
export * from './harness/sandbox';
export * from './orchestration/mcp';
export * from './harness/runtimeStatus';
export * from './orchestration/subagents';
export * from './harness/security';
