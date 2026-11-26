/**
 * SideChannel —— 侧通道面板纯展示视图。
 */
import { Plus, X, GitBranch, XCircle, Loader2 } from 'lucide-react';
import type { ComponentType } from 'react';
import type { SideChannelViewProps, SideChannelRowInfo } from '@/contracts/conversation/sideChannel';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import s from './SideChannelView.module.css';

const ICONS: Record<string, ComponentType> = { 'git-branch': GitBranch };

export function SideChannelView({
  t,
  iconName,
  title,
  subtitle,
  width,
  runningCount,
  loading,
  error,
  channels,
  showForm,
  agentName,
  prompt,
  isMutating,
  statusVariant,
  onStartSubmit,
  onAgentNameChange,
  onPromptChange,
  onToggleForm,
  onCancel,
  labels,
}: SideChannelViewProps) {
  return (
    <PageShell icon={ICONS[iconName]} title={title} subtitle={subtitle} width={width}
      actions={
        <Badge variant={runningCount > 0 ? 'accent' : 'neutral'}>
          {labels.runningCount(runningCount)}
        </Badge>
      }
    >
      <Card level="outlined" padding="md">
        <p role="status">{labels.unavailable}</p>
      </Card>
      {showForm ? (
        <form className={s.startForm} data-testid="side-channel-start-form" onSubmit={(e) => { e.preventDefault(); onStartSubmit(); }}>
          <input className={s.formInput} placeholder={labels.agentNamePlaceholder} value={agentName}
            onChange={(e) => onAgentNameChange(e.target.value)} data-testid="side-channel-start-name" />
          <input className={s.formInput} placeholder={labels.promptPlaceholder} value={prompt}
            onChange={(e) => onPromptChange(e.target.value)} data-testid="side-channel-start-prompt" />
          <div className={s.formActions}>
            <button type="button" className={s.cancelBtn} onClick={onToggleForm} data-testid="side-channel-start-cancel">
              <Icon icon={X} size={12} /> {t('common.cancel')}
            </button>
            <button type="submit" className={s.submitBtn} disabled={isMutating} data-testid="side-channel-start-submit">
              {isMutating ? <Icon icon={Loader2} size={12} /> : <Icon icon={Plus} size={12} />}
              {labels.start}
            </button>
          </div>
        </form>
      ) : (
        <div className={s.toolbar}>
          <button type="button" className={s.addBtn} onClick={onToggleForm} data-testid="side-channel-add-btn">
            <Icon icon={Plus} size={12} /> {labels.startOne}
          </button>
        </div>
      )}

      {loading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : error ? (
        <Card level="flat" padding="none">
          <EmptyState icon={<Icon icon={GitBranch} />} title={labels.failed} description={labels.failedDesc} />
        </Card>
      ) : channels.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState icon={<Icon icon={GitBranch} />} title={labels.empty} description={labels.emptyDesc} />
        </Card>
      ) : (
        <div className={s.list} data-testid="side-channel-list">
          {channels.map((channel) => (
            <SideChannelRow key={channel.id} channel={channel} variant={statusVariant(channel.status)}
              onCancel={onCancel} cancelLabel={t('common.cancel')} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function SideChannelRow({ channel, variant, onCancel, cancelLabel }: {
  channel: SideChannelRowInfo;
  variant: 'neutral' | 'accent' | 'success' | 'danger';
  onCancel: (id: string) => void;
  cancelLabel: string;
}) {
  const isRunning = channel.status === 'running';
  return (
    <div className={s.row} data-testid={`side-channel-row-${channel.id}`}>
      <div className={s.rowMain}>
        <code className={s.rowId}>{channel.id}</code>
        <span className={s.rowName}>{channel.agentName}</span>
        <span className={s.rowPrompt}>{channel.prompt}</span>
        {channel.durationMs != null && (
          <span className={s.rowDuration}>{(channel.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      <div className={s.rowSide}>
        <Badge variant={variant}>
          {isRunning && <Icon icon={Loader2} size={10} />} {channel.status}
        </Badge>
        {isRunning && (
          <button type="button" className={`${s.actionBtn} ${s.actionBtnDanger}`} onClick={() => onCancel(channel.id)}
            title={cancelLabel} data-testid={`side-channel-cancel-${channel.id}`}>
            <Icon icon={XCircle} size={12} /> {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}
