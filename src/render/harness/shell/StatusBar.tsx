import { Sun, Moon, Monitor, AlertCircle, MessagesSquare, Coins, Shield } from 'lucide-react';
import type { StatusBarProps } from '@/contracts/harness/statusBar';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { Tooltip } from '../design-system/Tooltip';
import { ContextGauge } from './ContextGauge';
import s from './StatusBar.module.css';

export function StatusBar({ t, tp, ctrl }: StatusBarProps) {
  const { permissionMode, cyclePermissionMode, mcpServers, lspServers, lastError, clearError, tokens,
    sandboxQuery: sandboxQ, sessionCount, ctx, resolved, mode, cycleTheme, modelLabel, modelKind,
    modelTooltip } = ctrl;
  const mcpFailed = mcpServers.filter((server) => server.status === 'failed').length;
  const lspFailed = lspServers.filter((server) => server.status === 'failed').length;
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
        <button className={s.btn} onClick={() => void cyclePermissionMode()} title={t('shell.cyclePermission')}>
          {permissionMode === 'auto'
            ? t('composer.controls.perm.auto')
            : permissionMode === 'prompt'
              ? t('composer.controls.perm.ask')
              : permissionMode === 'plan'
                ? t('composer.controls.perm.plan')
                : permissionMode}
        </button>
        {ctx.pct !== null && (
          <Tooltip
            label={[
              t('shell.contextStatus', {
                pct: String(ctx.pct),
                used: ctx.usedTokens.toLocaleString(),
                total: (ctx.windowSize ?? 0).toLocaleString(),
              }),
              ...(tokens
                ? [
                    `${t('inspector.tokenInput')}: ${tokens.input.toLocaleString()}`,
                    `${t('inspector.tokenOutput')}: ${tokens.output.toLocaleString()}`,
                    `${t('inspector.tokenCached')}: ${tokens.cached.toLocaleString()}`,
                  ]
                : []),
            ].join('\n')}
            side="top"
            multiline
          >
            {/* F52:环形仪表取代纯文本 —— 档位着色(Normal/Warning/Critical)。
                点击落右 dock 检查器概览页(用量明细的完整视图)。 */}
            <span
              data-testid="statusbar-context"
              data-warn={ctx.warn || undefined}
              style={{ cursor: 'pointer' }}
              onClick={() => ctrl.openInspectorOverview()}
            >
              <ContextGauge t={t} ratio={ctx.ratio ?? 0} pct={ctx.pct ?? 0} windowSize={ctx.windowSize ?? 0} usedTokens={ctx.usedTokens} />
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
