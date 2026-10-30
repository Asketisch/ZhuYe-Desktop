/**
 * StatusBar —— IDE 风底部状态栏。
 *
 * 左：model @ provider · permission · 上下文占比。
 *    （打开的目录 + git 分支已移至 Composer 下方上下文条 —— 它们是
 *    对话框侧的会话上下文而非全局状态，见 ComposerContextBar。）
 * 右：MCP/LSP 状态点 · 错误计数 · token · 主题切换。
 *
 * **数据优先级**（避免「no model」误报）：
 *   1. `useAgentStore.session` —— 由 `session_configured` 事件填充，最权威。
 *   2. fallback 到 `reflect_agent_status` 查询结果（启动期 / 降级模式 / 事件未到时）。
 *   3. 都没有时才显示「no model」。
 *
 * 替代旧的 widgets/StatusBar（Topbar/BottomBar），移除所有 "M1.7 scaffold" 字样。
 */
import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor, AlertCircle, MessagesSquare, Coins, Shield } from 'lucide-react';
import { Icon, IconButton, Tooltip } from '@/features/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useQuery } from '@tanstack/react-query';
import { reflect_agent_status, reflect_list_sessions, reflect_sandbox_status } from '@/utils/commands';
import { getTheme, setTheme, getResolvedTheme, subscribeTheme, type ThemeMode } from '@/utils/theme';
import { useI18n } from '@/utils/i18n';
import { useContextRatio } from './useContextRatio';
import { isUsableModelSpec } from './modelLabel';
import s from './StatusBar.module.css';

export function StatusBar() {
  const session = useAgentStore((st) => st.session);
  const permissionMode = useAgentStore((st) => st.permissionMode);
  const cyclePermission = useAgentStore((st) => st.cyclePermissionMode);
  const mcpServers = useAgentStore((st) => st.mcpServers);
  const lspServers = useAgentStore((st) => st.lspServers);
  const lastError = useAgentStore((st) => st.lastError);
  const clearError = useAgentStore((st) => st.clearError);
  const tokens = useAgentStore((st) => st.tokens);
  const { t, tp } = useI18n();

  const statusQ = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => reflect_list_sessions(),
    staleTime: 60_000,
  });
  // OS 沙箱有效状态 —— 安全相关的开关必须可见(是否真的在 Seatbelt /
  // Landlock 里跑)。口径 = 每轮真正下发的策略(后端按配置快照盖章),
  // 与 BashTool 实际使用的构造器同源。
  const sandboxQ = useQuery({
    queryKey: ['sandbox-status'],
    queryFn: reflect_sandbox_status,
    staleTime: 60_000,
  });
  const sessionCount = sessionsQ.data?.length ?? 0;

  const ctx = useContextRatio();

  // 主题：resolved 态驱动图标，mode 驱动循环。
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => getResolvedTheme());
  const [mode, setMode] = useState<ThemeMode>(() => getTheme());
  useEffect(() => subscribeTheme(setResolved), []);

  const cycleTheme = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
    setTheme(next);
    setMode(next);
  };

  const mcpFailed = mcpServers.filter((m) => m.status === 'failed').length;
  const lspFailed = lspServers.filter((l) => l.status === 'failed').length;

  // 模型显示：优先 store.session（事件填充），fallback 到 status 查询。
  // session 里的 "stub/test" 占位(无 provider/model 的降级线程)不算可用 ——
  // 落到 has_model 判定,最终显示「未配置模型」。
  const status = statusQ.data;
  const sessionModel =
    session && isUsableModelSpec(session.model) ? `${session.model} @ ${session.provider}` : null;
  const modelLabel = sessionModel ?? (status && status.has_model ? status.model : null);
  const modelKind: 'ok' | 'warn' | 'error' = status?.degraded_reason
    ? 'warn'
    : sessionModel != null || (status && status.has_model)
      ? 'ok'
      : 'error';
  const modelTooltip = status?.degraded_reason ?? undefined;

  return (
    <footer className={s.bar}>
      <div className={s.group}>
        {modelLabel ? (
          <span className={s.item} title={modelTooltip}>
            <span className={s.dot} data-kind={modelKind} />
            {modelLabel}
          </span>
        ) : (
          <Tooltip label={modelTooltip ?? t('shell.noModelTooltip')} side="top">
            <span className={s.item}>
              <span className={s.dot} data-kind={modelKind} />
              {t('shell.noModel')}
            </span>
          </Tooltip>
        )}
        <button className={s.btn} onClick={() => cyclePermission()} title={t('shell.cyclePermission')}>
          {permissionMode}
        </button>
        {ctx.pct !== null && (
          <Tooltip
            label={t('shell.contextStatus', {
              pct: String(ctx.pct),
              used: ctx.usedTokens.toLocaleString(),
              total: (ctx.windowSize ?? 0).toLocaleString(),
            })}
            side="top"
          >
            <span className={s.itemMuted} data-testid="statusbar-context" data-warn={ctx.warn || undefined}>
              {ctx.pct}%
            </span>
          </Tooltip>
        )}
      </div>

      <div className={s.group}>
        {lastError && (
          <Tooltip label={lastError} side="top">
            <button className={s.item} onClick={clearError} data-kind="error">
              <Icon icon={AlertCircle} size={12} />
              {t('shell.errorButton')}
            </button>
          </Tooltip>
        )}
        {(mcpFailed > 0 || lspFailed > 0) && (
          <Tooltip label={t('shell.mcpLspFailed', { mcp: mcpFailed, lsp: lspFailed })} side="top">
            <span className={s.item} data-kind="error">
              {t('shell.failedCount', { count: mcpFailed + lspFailed })}
            </span>
          </Tooltip>
        )}
        {mcpServers.length > 0 && (
          <span className={s.itemMuted}>
            {t('shell.mcpCount', { count: mcpServers.length })}
          </span>
        )}
        {tokens && (
          <Tooltip
            label={[
              `${t('inspector.tokenInput')}: ${tokens.input.toLocaleString()}`,
              `${t('inspector.tokenOutput')}: ${tokens.output.toLocaleString()}`,
              `${t('inspector.tokenCached')}: ${tokens.cached.toLocaleString()}`,
              `${t('inspector.tokenCacheWrite')}: ${tokens.cacheWrite.toLocaleString()}`,
              `${t('inspector.tokenTotal')}: ${tokens.total.toLocaleString()}`,
              ...(tokens.cost != null
                ? [`${t('shell.costLast')}: $${tokens.cost.toFixed(4)}`]
                : []),
              ...(tokens.sessionCost > 0
                ? [`${t('shell.costSession')}: $${tokens.sessionCost.toFixed(4)}`]
                : []),
            ]
              .filter(Boolean)
              .join('\n')}
            side="top"
            multiline
          >
            <span className={s.itemMuted} data-testid="statusbar-tokens">
              <Icon icon={Coins} size={11} />
              {tokens.total.toLocaleString()}
            </span>
          </Tooltip>
        )}
        {tokens != null && tokens.sessionCost > 0 && (
          <Tooltip label={`${t('shell.costSession')}: $${tokens.sessionCost.toFixed(4)}`} side="top">
            <span className={s.itemMuted} data-testid="statusbar-cost">
              {`$${tokens.sessionCost < 1 ? tokens.sessionCost.toFixed(4) : tokens.sessionCost.toFixed(2)}`}
            </span>
          </Tooltip>
        )}
        <Tooltip label={tp('shell.sessionCount', sessionCount, { count: sessionCount })} side="top">
          <span className={s.itemMuted} data-testid="statusbar-session-count">
            <Icon icon={MessagesSquare} size={11} /> {sessionCount}
          </span>
        </Tooltip>
        {sandboxQ.data && (
          <Tooltip
            label={`${t('shell.sandbox')}: ${sandboxQ.data.status}${
              sandboxQ.data.statusLine ? `\n${sandboxQ.data.statusLine}` : ''
            }${
              sandboxQ.data.envOverride
                ? `\n${t('shell.sandboxEnvOverride', { value: sandboxQ.data.envOverride })}`
                : ''
            }`}
            side="top"
            multiline
          >
            <span
              className={s.itemMuted}
              data-testid="statusbar-sandbox"
              data-active={sandboxQ.data.active || undefined}
            >
              <Icon icon={Shield} size={11} />
              {sandboxQ.data.status}
            </span>
          </Tooltip>
        )}
        <Tooltip label={t('shell.themeCurrent', { mode: mode })} side="top">
          <IconButton
            label={t('shell.themeCurrent', { mode: mode })}
            size="sm"
            onClick={cycleTheme}
            className={s.themeBtn}
          >
            <Icon icon={mode === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun} size={13} />
          </IconButton>
        </Tooltip>
      </div>
    </footer>
  );
}
