/**
 * 模型组设置页 —— 唯一的模型接入管理面。
 *
 * 两层内容：
 * 1. **默认模型组**：全部 `[[model_group]]` 平铺成卡片，点击即把
 *    `[active].group` 切过去（组 id 直接注册为引擎的凭证池名）。
 * 2. **模型组管理**（GroupForm：增删改 + 组内凭据池 + 自动拉模型），
 *    外加 **额度耗尽自动切换 / 自动压缩** 开关。
 *
 * 旧「提供商方案（coding plan）」层已移除 —— 多凭据 / 配额声明下沉为
 * 组内凭据（`[[model_group.credentials]]`），由 GroupForm 编辑。
 *
 * 与 ConfigForm 共享同一份 rawToml buffer（props 传入），每个完整意图
 * （保存/删除/设为默认）经 onCommit 即时落盘 —— 模型选择器读到的
 * 永远是新配置。
 */
import { useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Badge, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  AUTO_FAILOVER_PREF_KEY,
  isAutoFailoverEnabled,
} from '@/stores/agent/planFailover';
import {
  AUTO_COMPACT_PREF_KEY,
  isAutoCompactEnabled,
} from '@/stores/agent/autoCompact';
import {
  groupDisplayLabel,
  listGroups,
  readActiveGroup,
  setActiveGroup,
} from '../config/groups';
import { GroupForm } from './GroupForm';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupsSectionProps {
  rawToml: string;
  onChange: (next: string) => void;
  /** 把变更立即落盘（zhuye_save_config → 后端校验 + 热重载 provider 栈）。
   *  本页每个操作都是完整意图，不应要求用户再去点页面底部的总保存按钮
   *  —— 否则模型选择器读到的仍是旧配置。 */
  onCommit?: (next: string) => void;
  /** agent 状态（就绪徽标）。 */
  status?: { model: string; degraded_reason?: string | null; has_model: boolean };
  loading?: boolean;
}

export function GroupsSection({ rawToml, onChange, onCommit, status, loading }: GroupsSectionProps) {
  const { t } = useI18n();
  const [autoFailover, setAutoFailover] = useState(isAutoFailoverEnabled);
  const [autoCompact, setAutoCompact] = useState(isAutoCompactEnabled);

  const groups = listGroups(rawToml);
  const activeGroup = readActiveGroup(rawToml);
  const hasModel = Boolean(status?.has_model);

  const onToggleAutoFailover = (enabled: boolean) => {
    setAutoFailover(enabled);
    try {
      localStorage.setItem(AUTO_FAILOVER_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // localStorage 不可用（隐私模式等）—— UI 状态仍然生效到本会话。
    }
  };

  const onToggleAutoCompact = (enabled: boolean) => {
    setAutoCompact(enabled);
    try {
      localStorage.setItem(AUTO_COMPACT_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // localStorage 不可用（隐私模式等）—— UI 状态仍然生效到本会话。
    }
  };

  return (
    <section data-testid="groups-section">
      {/* 状态徽标 —— 契约 'Agent ready'。模型接入的就绪状态,只在本页显示。 */}
      <div className={s.statusBar} data-ok={hasModel || undefined}>
        <Icon icon={hasModel ? CheckCircle2 : AlertTriangle} size={14} />
        <span>
          {loading
            ? t('settings.loading')
            : hasModel
              ? <>{t('settings.status.ready', { model: status?.model ?? '' })} <code className={s.codeInline}>{status?.model}</code></>
              : <>{t('settings.status.degraded', { reason: status?.degraded_reason ?? t('settings.status.noProvider') })} {t('settings.status.noProviderHint')}</>}
        </span>
      </div>
      <h3 className={s.sectionTitle}>{t('settings.groups.title')}</h3>
      <p className={s.sectionDesc}>{t('settings.groups.desc')}</p>

      {/* 默认模型组（[active].group）—— 全部模型组平铺 */}
      <h4 className={s.sectionTitle}>{t('settings.groups.defaultGroup')}</h4>
      {groups.length === 0 && <p className={s.sectionDesc}>{t('settings.groups.empty')}</p>}
      <div className={s.permGrid}>
        {groups.map((group) => (
          <button
            key={group.id}
            className={s.permCard}
            data-active={group.id === activeGroup || undefined}
            data-testid={`group-default-${group.id}`}
            onClick={() => {
              const next = setActiveGroup(rawToml, group.id);
              onChange(next);
              onCommit?.(next);
            }}
          >
            <div className={s.permCardHeader}>
              <Badge variant={group.id === activeGroup ? 'success' : 'neutral'} solid>
                {group.id === activeGroup ? t('settings.groups.defaultBadge') : groupDisplayLabel(group)}
              </Badge>
              {group.id !== activeGroup && <span className={s.providerName}>{group.endpoint}</span>}
            </div>
            <p className={s.permDesc}>
              {t('settings.groups.groupDesc', {
                count: group.credentials.length,
                endpoint: group.endpoint,
              })}
            </p>
          </button>
        ))}
      </div>

      {/* 模型组管理（列表 + 增删改 + 组内凭据 + 自动拉模型） */}
      <GroupForm rawToml={rawToml} onChange={onChange} onCommit={onCommit} />

      {/* 额度耗尽自动切换 */}
      <h4 className={s.sectionTitle}>{t('settings.groups.autoFailover')}</h4>
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoFailover}
          onChange={(e) => onToggleAutoFailover(e.target.checked)}
          data-testid="groups-auto-failover"
        />
        <span className={s.fieldLabel}>{t('settings.groups.autoFailoverLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.groups.autoFailoverDesc')}</p>

      {/* 按最大上下文自动压缩 */}
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoCompact}
          onChange={(e) => onToggleAutoCompact(e.target.checked)}
          data-testid="groups-auto-compact"
        />
        <span className={s.fieldLabel}>{t('settings.groups.autoCompactLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.groups.autoCompactDesc')}</p>
    </section>
  );
}
