/**
 * Models —— 当前模型卡片、模型组切换与 reasoning effort 控件。
 *
 * 模型页按「模型组」列出（配置里只剩模型组一层）：组 id 才是接入目标，
 * 「设为默认」写 `[active].group`。
 */
import { Cpu, Folder, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import type { ModelsViewProps } from '@/contracts/models';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';
import { SegmentedControl } from '../design-system/SegmentedControl';
import s from './ModelsView.module.css';

export function ModelsView({ t, loading, hasModel, model, abilityTags, workspace, degradedReason, groups,
  effort, effortOptions, effortAdjusted, effortEffectiveLabel, saved, onGoSettings, onSwitchGroup,
  onEffortChange, onApplyEffort }: ModelsViewProps) {
  return (
    <div className={s.root}>
      <header className={s.header}>
        <h1 className={s.title}>{t('models.title')}</h1>
        <p className={s.subtitle}>{t('models.subtitle')}</p>
      </header>

      <section>
        <h2 className={s.sectionTitle}>{t('models.currentModel')}</h2>
        {loading ? (
          <Card level="outlined" padding="md"><p className={s.loading}>{t('common.loading')}</p></Card>
        ) : hasModel ? (
          <Card level="outlined" padding="lg" className={s.modelCard}>
            <div className={s.modelIcon}><Icon icon={Cpu} size={24} /></div>
            <div className={s.modelBody}>
              <div className={s.modelNameRow}>
                <code className={s.modelName}>{model}</code>
                <Badge variant="success" dot>{t('about.ready')}</Badge>
              </div>
              {/* 能力标签在绑定层拼好本地化文案,全未知时不渲染。 */}
              {abilityTags.length > 0 && (
                <div className={s.abilityRow} data-testid="models-ability-row">
                  {abilityTags.map((tag) => (<span key={tag}>{tag}</span>))}
                </div>
              )}
              {workspace && (
                <div className={s.workspaceRow}>
                  <Icon icon={Folder} size={12} />
                  <code className={s.workspace}>{workspace}</code>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card level="outlined" padding="lg">
            <EmptyState
              icon={<Icon icon={AlertTriangle} />}
              title={t('models.noGroup')}
              description={<>{degradedReason ?? t('models.noGroupDesc')} {t('models.configureHint')}</>}
              action={<Button variant="primary" size="sm" onClick={onGoSettings}>{t('palette.item.goSettings')}</Button>}
            />
          </Card>
        )}
      </section>

      <section>
        <h2 className={s.sectionTitle}>{t('models.groups')}</h2>
        {groups.length === 0 ? (
          <Card level="outlined" padding="lg"><p className={s.loading}>{t('models.groupsEmpty')}</p></Card>
        ) : (
          <div className={s.groupList}>
            {groups.map((group) => (
              <Card key={group.id} level="outlined" padding="md" className={s.groupCard}>
                <div className={s.groupMain}>
                  <div className={s.groupTitleRow}>
                    <code className={s.groupLabel}>{group.label}</code>
                    <Badge variant={group.isDefault ? 'success' : 'info'}>{group.id}</Badge>
                    <Badge variant="info">{group.endpoint}</Badge>
                  </div>
                  <div className={s.groupMetaRow}>
                    {group.model && <span>{group.model}</span>}
                    <span>{t('models.groupCredentials', { count: group.credentialCount })}</span>
                    {group.pinnedCredential && <span>● {group.pinnedCredential}</span>}
                  </div>
                </div>
                <Button variant={group.isDefault ? 'ghost' : 'primary'} size="sm"
                  disabled={group.isDefault || group.switching}
                  loading={group.switching}
                  onClick={() => onSwitchGroup(group)}>
                  {group.isDefault ? t('models.groupIsDefault') : t('models.groupSetDefault')}
                </Button>
              </Card>
            ))}
          </div>
        )}
        <p className={s.note}>{t('models.groupsHint')}</p>
      </section>

      <section>
        <h2 className={s.sectionTitle}>{t('models.effort')}</h2>
        <Card level="outlined" padding="lg">
          <div className={s.effortHeader}>
            <div className={s.effortLabel}>
              <Icon icon={Zap} size={14} />
              <span>{t('models.effortHint')}</span>
            </div>
            <SegmentedControl value={effort} onChange={onEffortChange} options={effortOptions} stacked />
          </div>
          <div className={s.effortApply}>
            <Button variant="primary" onClick={onApplyEffort} leftIcon={<Icon icon={CheckCircle2} size={14} />}>
              {saved ? t('models.applied') : t('models.applyEffort')}
            </Button>
            <span className={s.effortHint}>{effortOptions.find((o) => o.value === effort)?.hint}</span>
            {effortAdjusted && (
              <span className={s.effortHint} data-testid="models-effort-effective">
                {effortEffectiveLabel ? t('composer.controls.effort.effective', { level: effortEffectiveLabel }) : t('composer.controls.effort.disabled')}
              </span>
            )}
          </div>
          <p className={s.note}>{t('models.settingsHint', { path: t('settings.groups.title') })}</p>
        </Card>
      </section>
    </div>
  );
}
