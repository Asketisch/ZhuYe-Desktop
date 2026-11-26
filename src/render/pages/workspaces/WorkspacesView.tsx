/**
 * Workspaces —— 项目工作区管理，含最近项目与附加目录编辑。
 */
import { FolderOpen, CheckCircle2, ArrowRight, FolderSearch, FileSearch, FolderPlus, RotateCcw, Trash2, X } from 'lucide-react';
import type { WorkspacesViewProps } from '@/contracts/workbench/workspaces';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { Badge } from '@/render/harness/design-system/Badge';
import { Icon } from '@/render/harness/design-system/Icon';
import { Spinner } from '@/render/harness/design-system/Spinner';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import { Button } from '@/render/harness/design-system/Button';
import s from './WorkspacesView.module.css';

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function WorkspacesView({ t, tp, current, loading, error, errorMessage, workspaces, removed, dirs,
  onOpenFolder, onReveal, onUse, onRemove, onAddDir, onRemoveDir }: WorkspacesViewProps) {
  return (
    <PageShell icon={FolderOpen} title={t('workspaces.title')} subtitle={t('workspaces.subtitle')} width="md">
      <Card level="outlined" padding="md" className={s.currentCard}>
        <div className={s.currentRow}>
          <Icon icon={CheckCircle2} size={14} />
          <span className={s.currentLabel}>{t('workspaces.current')}</span>
          <code className={s.currentPath} data-testid="workspaces-current">{current ?? t('common.loading')}</code>
        </div>
        <div className={s.currentActions}>
          <Button size="sm" variant="primary" leftIcon={<Icon icon={FolderSearch} size={14} />}
            onClick={onOpenFolder} data-testid="workspaces-open-folder">{t('workspaces.openFolder')}</Button>
          {current && <Button size="sm" variant="ghost" leftIcon={<Icon icon={FileSearch} size={14} />}
            onClick={() => onReveal(current)} data-testid="workspaces-reveal-current">{t('workspaces.reveal')}</Button>}
        </div>
        <div className={s.additionalDirs} data-testid="workspace-additional-dirs">
          <div className={s.currentRow}>
            <Icon icon={FolderPlus} size={14} />
            <span className={s.currentLabel}>{t('workspaces.additionalDirs')}</span>
            <Button size="sm" variant="ghost" onClick={onAddDir} data-testid="workspaces-additional-add">
              {t('workspaces.additionalAdd')}
            </Button>
          </div>
          {dirs.adding && <p className={s.note}>{t('workspaces.additionalPicking')}</p>}
          {dirs.additional.length > 0 ? (
            <ul className={s.additionalList}>
              {dirs.additional.map((dir) => (
                <li key={dir} className={s.additionalRow} data-testid={`workspace-additional-${basename(dir)}`}>
                  <code className={s.wsPath}>{dir}</code>
                  <Button size="sm" variant="ghost" onClick={() => onRemoveDir(dir)}
                    aria-label={t('workspaces.additionalRemove')} data-testid={`workspace-additional-remove-${basename(dir)}`}>
                    <Icon icon={X} size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className={s.note}>{t('workspaces.additionalEmpty')}</p>}
        </div>
        <p className={s.note}>{t('workspaces.note')}</p>
      </Card>

      <h3 className={s.sectionTitle}>{t('workspaces.recent')}</h3>
      {loading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : error ? (
        <Card level="flat" padding="none"><EmptyState icon={<Icon icon={FolderOpen} />} title={t('workspaces.loadFailed')} description={errorMessage ?? t('workspaces.loadFailed')} /></Card>
      ) : workspaces.length === 0 ? (
        <Card level="flat" padding="none"><EmptyState icon={<Icon icon={FolderOpen} />} title={t('workspaces.empty')} description={t('workspaces.emptyDesc')} /></Card>
      ) : (
        <div className={s.list} data-testid="workspaces-list">
          {workspaces.map((w) => (
            <Card key={w.path} level="outlined" padding="sm" className={s.wsCard}
              data-active={w.isActive || undefined} data-testid={`workspace-card-${basename(w.path)}`}>
              <div className={s.wsIcon}><Icon icon={FolderOpen} size={16} /></div>
              <div className={s.wsBody}>
                <div className={s.wsNameRow}>
                  <span className={s.wsName}>{w.label || basename(w.path)}</span>
                  {w.isActive && <Badge variant="success" dot>{t('home.active')}</Badge>}
                </div>
                <div className={s.wsMeta}>
                  <code className={s.wsPath}>{w.path}</code>
                  <span className={s.wsSep}>·</span>
                  <span>{tp('workspaces.sessionCount', w.sessionCount, { count: w.sessionCount })}</span>
                  <span className={s.wsSep}>·</span>
                  <span>{w.lastUsedLabel}</span>
                </div>
              </div>
              <div className={s.wsActions}>
                <Button size="sm" variant="ghost" onClick={() => onReveal(w.path)}
                  aria-label={t('workspaces.reveal')} data-testid={`workspace-reveal-${basename(w.path)}`}>
                  <Icon icon={FileSearch} size={12} />
                </Button>
                {!w.isActive && <Button size="sm" variant="ghost" onClick={() => onUse(w.path)}
                  data-testid={`workspace-use-${basename(w.path)}`}>{t('workspaces.use')} <Icon icon={ArrowRight} size={12} /></Button>}
                {!w.isActive && <Button size="sm" variant="ghost" onClick={() => onRemove(w.path)}
                  aria-label={t('workspaces.remove')} data-testid={`workspace-remove-${basename(w.path)}`}>
                  <Icon icon={Trash2} size={12} />
                </Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {removed.length > 0 && (
        <>
          <h3 className={s.sectionTitle}>{t('workspaces.removedTitle')}</h3>
          <div className={s.list} data-testid="workspaces-removed-list">
            {removed.map((w) => (
              <Card key={w.path} level="outlined" padding="sm" className={s.wsCard}
                data-testid={`workspace-removed-${basename(w.path)}`}>
                <div className={s.wsIcon}><Icon icon={FolderOpen} size={16} /></div>
                <div className={s.wsBody}>
                  <div className={s.wsNameRow}><span className={s.wsName}>{w.label || basename(w.path)}</span></div>
                  <div className={s.wsMeta}><code className={s.wsPath}>{w.path}</code></div>
                </div>
                <div className={s.wsActions}>
                  <Button size="sm" variant="ghost" onClick={() => onUse(w.path)}
                    data-testid={`workspace-restore-${basename(w.path)}`}>
                    <Icon icon={RotateCcw} size={12} /> {t('workspaces.restore')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
