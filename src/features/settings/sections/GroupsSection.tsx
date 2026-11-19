/**
 * 模型组设置页 —— 统一的模型接入管理面（对标 ZCode / Magpie 的
 * provider 分组模型选择）。
 *
 * 三层内容：
 * 1. **默认模型组**：内置端口（anthropic / openai，凡有可用 plan）与
 *    自定义组（`[[provider_group]]`）平铺成卡片，点击即把
 *    `[active].provider` 切过去 —— 内置端口与组从此是同一种东西
 *    （组 id 直接注册为引擎的凭证池名）。
 * 2. **内置端口 plan 管理**（PlansSection：列表 + 增删改 + 拉模型 +
 *    连通测试）与 **自定义组管理**（GroupForm：保存后自动拉取组内
 *    模型清单，点选即设组默认模型）。
 * 3. **额度耗尽自动切换 / 自动压缩** 开关（自 PlansSection 上移）。
 *
 * 与 ConfigForm 共享同一份 rawToml buffer（props 传入），每个完整意图
 * （保存/删除/设为默认）经 onCommit 即时落盘 —— 模型选择器读到的
 * 永远是新配置。
 */
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
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
  listPlans,
  pickFailoverProvider,
  readActiveProvider,
  setActiveProvider,
  providerHasUsablePlan,
  type PlanProvider,
} from '../config/plans';
import {
  groupDisplayLabel,
  listGroups,
  setActiveGroup,
} from '../config/groups';
import { PlansSection } from './PlansSection';
import { GroupForm } from './GroupForm';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupsSectionProps {
  rawToml: string;
  onChange: (next: string) => void;
  /** 把变更立即落盘（reflect_save_config → 后端校验 + 热重载 provider 栈）。
   *  本页每个操作都是完整意图，不应要求用户再去点页面底部的总保存按钮
   *  —— 否则模型选择器读到的仍是旧配置。 */
  onCommit?: (next: string) => void;
}

export function GroupsSection({ rawToml, onChange, onCommit }: GroupsSectionProps) {
  const { t } = useI18n();
  const [autoFailover, setAutoFailover] = useState(isAutoFailoverEnabled);
  const [autoCompact, setAutoCompact] = useState(isAutoCompactEnabled);

  const plans = listPlans(rawToml);
  const groups = listGroups(rawToml);
  const activeProvider = readActiveProvider(rawToml);
  // 备选提示:默认目标耗尽时,自动切换会落到下一个有可用 plan 的内置端口。
  const backup = pickFailoverProvider(rawToml, activeProvider || 'x');

  /** 内置端口卡片:仅当该端口有可用 plan(有 key 或有 base_url)才出现,
   * 与「没配 = 不注册」的引擎口径一致。 */
  const builtinPorts = (['anthropic', 'openai'] as PlanProvider[]).filter((p) =>
    providerHasUsablePlan(rawToml, p),
  );

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
      <h3 className={s.sectionTitle}>{t('settings.groups.title')}</h3>
      <p className={s.sectionDesc}>{t('settings.groups.desc')}</p>

      {/* 默认模型组（[active].provider）—— 内置端口与自定义组平铺 */}
      <h4 className={s.sectionTitle}>{t('settings.groups.defaultGroup')}</h4>
      <div className={s.permGrid}>
        {builtinPorts.map((provider) => (
          <button
            key={provider}
            className={s.permCard}
            data-active={provider === activeProvider || undefined}
            data-testid={`provider-default-${provider}`}
            onClick={() => {
              const next = setActiveProvider(rawToml, provider);
              onChange(next);
              onCommit?.(next);
            }}
          >
            <div className={s.permCardHeader}>
              <Badge variant={provider === activeProvider ? 'success' : 'neutral'} solid>
                {provider === activeProvider ? t('settings.plans.defaultBadge') : provider}
              </Badge>
              {provider !== activeProvider && <span className={s.providerName}>{provider}</span>}
            </div>
            <p className={s.permDesc}>{t('settings.groups.builtinPortDesc', { count: String(plans.filter((p) => p.provider === provider).length) })}</p>
          </button>
        ))}
        {groups.map((group) => (
          <button
            key={group.id}
            className={s.permCard}
            data-active={group.id === activeProvider || undefined}
            data-testid={`provider-default-group-${group.id}`}
            onClick={() => {
              const next = setActiveGroup(rawToml, group.id);
              onChange(next);
              onCommit?.(next);
            }}
          >
            <div className={s.permCardHeader}>
              <Badge variant={group.id === activeProvider ? 'success' : 'neutral'} solid>
                {group.id === activeProvider ? t('settings.plans.defaultBadge') : groupDisplayLabel(group)}
              </Badge>
              {group.id !== activeProvider && <span className={s.providerName}>{group.endpoint}</span>}
            </div>
            <p className={s.permDesc}>{t('settings.groups.customGroupDesc')}</p>
          </button>
        ))}
      </div>

      {/* 自定义组管理（列表 + 增删改 + 自动拉模型） */}
      <GroupForm rawToml={rawToml} onChange={onChange} onCommit={onCommit} />

      {/* 内置端口的 plan 凭证管理 */}
      <PlansSection rawToml={rawToml} onChange={onChange} onCommit={onCommit} />

      {backup && (
        <p className={s.hint}>
          <Icon icon={ShieldCheck} size={12} /> {t('settings.plans.backupHint', { provider: backup })}
        </p>
      )}

      {/* 额度耗尽自动切换 */}
      <h4 className={s.sectionTitle}>{t('settings.plans.autoFailover')}</h4>
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoFailover}
          onChange={(e) => onToggleAutoFailover(e.target.checked)}
        />
        <span className={s.fieldLabel}>{t('settings.plans.autoFailoverLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.plans.autoFailoverDesc')}</p>

      {/* 按最大上下文自动压缩 */}
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoCompact}
          onChange={(e) => onToggleAutoCompact(e.target.checked)}
          data-testid="plans-auto-compact"
        />
        <span className={s.fieldLabel}>{t('settings.plans.autoCompactLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.plans.autoCompactDesc')}</p>
    </section>
  );
}
