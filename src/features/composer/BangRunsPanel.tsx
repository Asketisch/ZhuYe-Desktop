/**
 * BangRunsPanel —— `!` 直通命令的本地输出面板（Composer 卡片上方）。
 *
 * 运行中显示 spinner + 终止按钮；完成态显示退出状态与输出
 * （等宽字体，可折叠长输出），手动关闭。不进会话历史。
 */
import { useState } from 'react';
import { ChevronRight, Square, TerminalSquare, X } from 'lucide-react';
import { Icon, IconButton, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import type { BangRun } from '@/logic/composer/useBangShell';
import s from '@/render/composer/BangRunsPanel.module.css';

const COLLAPSED_OUTPUT_CHARS = 1200;

export function BangRunsPanel({ runs, onDismiss, onKill }: {
  runs: BangRun[];
  onDismiss: (id: string) => void;
  onKill: (id: string) => void;
}) {
  const { t } = useI18n();
  if (runs.length === 0) return null;
  return (
    <div className={s.panel} role="log" aria-label={t('composer.bang.title')} data-testid="composer-bang-runs">
      {runs.map((run) => (
        <BangRunRow key={run.id} run={run} onDismiss={onDismiss} onKill={onKill} />
      ))}
      {runs.length > 0 && <p className={s.hint}>{t('composer.bang.hint')}</p>}
    </div>
  );
}

function BangRunRow({ run, onDismiss, onKill }: {
  run: BangRun;
  onDismiss: (id: string) => void;
  onKill: (id: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(run.status === 'running');
  const overflowing = run.output.length > COLLAPSED_OUTPUT_CHARS;
  const shown = expanded || run.status === 'running'
    ? run.output
    : run.output.slice(-COLLAPSED_OUTPUT_CHARS);

  return (
    <div className={s.row} data-status={run.status} data-testid={`bang-run-${run.id}`}>
      <div className={s.head}>
        <Icon icon={TerminalSquare} size={12} />
        <code className={s.command} title={run.command}>! {run.command}</code>
        {run.status === 'running' ? (
          <span className={s.state}><Spinner size={11} /> {t('composer.bang.running')}</span>
        ) : (
          <button type="button" className={s.expand} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <Icon icon={ChevronRight} size={11} className={expanded ? s.chevronOpen : undefined} />
            {run.status === 'error' ? t('composer.bang.failed') : t('composer.bang.done')}
          </button>
        )}
        <span className={s.spacer} />
        {run.status === 'running' ? (
          <IconButton label={t('composer.bang.kill')} size="sm" onClick={() => onKill(run.id)}>
            <Icon icon={Square} size={10} />
          </IconButton>
        ) : (
          <IconButton label={t('common.close')} size="sm" onClick={() => onDismiss(run.id)}>
            <Icon icon={X} size={11} />
          </IconButton>
        )}
      </div>
      {run.output && (
        <pre className={expanded ? s.outputExpanded : s.output}>{shown}</pre>
      )}
      {overflowing && !expanded && <p className={s.truncated}>{t('composer.bang.truncated')}</p>}
    </div>
  );
}
