/**
 * 模型组设置页 —— 唯一的模型接入管理面（主从布局）。
 *
 * 页头（内联状态点 + 添加按钮）→ 左列 GroupNav（组列表 + 凭据池健康点
 * + 全局开关）→ 右列 GroupDetail（选中组的编辑面板；null = 新增模式）。
 * 「设为默认」（`[active].group`）收进详情头的开关，替代旧「默认组卡片
 * 平铺」—— 组多了以后平铺既占屏又没有详情入口。
 *
 * 旧「提供商方案（coding plan）」层已移除 —— 多凭据 / 配额声明下沉为
 * 组内凭据（`[[model_group.credentials]]`），由 GroupDetail 编辑。
 *
 * 与 ConfigForm 共享同一份 rawToml buffer（props 传入），每个完整意图
 * （保存/删除/设为默认）经 onCommit 即时落盘 —— 模型选择器读到的
 * 永远是新配置。
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import { Button, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  AUTO_FAILOVER_PREF_KEY,
  isAutoFailoverEnabled,
} from '@/stores/agent/planFailover';
import {
  listGroups,
  readActiveGroup,
  readDefaultEffort,
  removeGroup,
  setActiveGroup,
  setDefaultEffort,
} from '../config/groups';
import { GroupNav } from './GroupNav';
import { useEffortCapability } from '@/logic/composer/useEffortCapability';
import { GroupDetail } from './GroupDetail';
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

  const groups = listGroups(rawToml);
  const activeGroup = readActiveGroup(rawToml);
  const hasModel = Boolean(status?.has_model);
  // 默认思考强度([model].reasoning_effort)—— 新会话的初始档位;运行时
  // Composer 仍可随时切换,每次重绑重新读配置。'' = 未设置(引擎默认 low)。
  // 选项 = 当前活跃模型支持的档位(引擎按 models.dev effort_levels 投票
  // 截断 5 档阶梯 —— 不同模型枚举不同);能力未知时回退全档。
  const effortCapability = useEffortCapability();
  const effortOptions = effortCapability.known && effortCapability.options.length > 0
    ? effortCapability.options
    : (['low', 'medium', 'high', 'max', 'ultra'] as const);
  const defaultEffort = readDefaultEffort(rawToml);
  const onPickDefaultEffort = (effort: string) => {
    const next = setDefaultEffort(rawToml, effort);
    onChange(next);
    onCommit?.(next);
  };

  // 选中组 id;null = 新增模式(空表单)。初始选中默认组,否则第一组。
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    groups.length > 0 ? activeGroup ?? groups[0].id : null,
  );
  const selectedGroup = selectedId != null ? groups.find((g) => g.id === selectedId) ?? null : null;

  // 选中组被删除(本页删除 / 手改 TOML)后回落:默认组 > 第一组 > 新增模式。
  useEffect(() => {
    if (selectedId != null && !selectedGroup) {
      setSelectedId(
        groups.find((g) => g.id === activeGroup)?.id ?? groups[0]?.id ?? null,
      );
    }
  }, [selectedId, selectedGroup, groups, activeGroup]);

  // 凭据池健康查询签名:组集合 / 凭据数 / 组级 key 变化才换 key 重查。
  const poolSignature = useMemo(
    () => groups.map((g) => `${g.id}:${g.credentials.length}:${g.apiKey ? 1 : 0}`).join('|'),
    [groups],
  );

  const onToggleAutoFailover = (enabled: boolean) => {
    setAutoFailover(enabled);
    try {
      localStorage.setItem(AUTO_FAILOVER_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // localStorage 不可用（隐私模式等）—— UI 状态仍然生效到本会话。
    }
  };

  return (
    <section data-testid="groups-section" className={s.groupsPage}>
      {/* 页头:内联状态点 + 添加按钮 */}
      <div className={s.groupsHeader}>
        <span className={s.groupsStatus} data-ok={hasModel || undefined}>
          <Icon icon={hasModel ? CheckCircle2 : AlertTriangle} size={14} />
          <span>
            {loading
              ? t('settings.loading')
              : hasModel
                ? <>{t('settings.status.ready', { model: status?.model ?? '' })} <code className={s.codeInline}>{status?.model}</code></>
                : <>{t('settings.status.degraded', { reason: status?.degraded_reason ?? t('settings.status.noProvider') })} {t('settings.status.noProviderHint')}</>}
          </span>
        </span>
        <span className={s.groupsHeaderSpacer} />
        <Button
          variant="secondary"
          size="sm"
          data-testid="groups-add"
          onClick={() => setSelectedId(null)}
        >
          <Icon icon={Plus} size={12} /> {t('settings.groups.addTitle')}
        </Button>
      </div>
      <p className={s.sectionDesc}>{t('settings.groups.desc')}</p>

      {/* 默认思考强度(全局活跃模型字段;下拉即时落盘) */}
      <div className={s.groupsHeader} data-testid="groups-default-effort">
        <span className={s.gSwitchRow}>
          <span
            className={s.gSwitchLabel}
            title={t('settings.groups.defaultEffortHint')}
          >
            {t('settings.groups.defaultEffort')}
          </span>
          <select
            value={defaultEffort}
            aria-label={t('settings.groups.defaultEffort')}
            data-testid="groups-default-effort-select"
            className={s.nativeSelect}
            onChange={(e) => onPickDefaultEffort(e.target.value)}
          >
            <option value="">{t('settings.groups.defaultEffortUnset')}</option>
            {effortOptions.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </span>
        <span className={s.groupsHeaderSpacer} />
      </div>

      {/* 主从布局:左列表 + 右详情 */}
      <div className={s.groupsLayout}>
        <div className={s.groupsNavCol}>
          <GroupNav
            groups={groups}
            activeId={activeGroup}
            selectedId={selectedId}
            poolSignature={poolSignature}
            onSelect={setSelectedId}
          />
          {/* 全局开关(非组级偏好)挂左列底部。自动压缩已下沉为组级配置
              (模型详情 → 高级配置 → 自动压缩阈值),不再有全局开关。 */}
          <div className={s.groupsNavFoot}>
            <span className={s.gSwitchRow}>
              <span
                className={s.gSwitchLabel}
                title={`${t('settings.groups.autoFailoverLabel')} ${t('settings.groups.autoFailoverDesc')}`}
              >
                {t('settings.groups.autoFailover')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoFailover}
                aria-label={t('settings.groups.autoFailover')}
                data-testid="groups-auto-failover"
                className={`sw${autoFailover ? ' on' : ''}`}
                onClick={() => onToggleAutoFailover(!autoFailover)}
              >
                <span />
              </button>
            </span>
          </div>
        </div>

        <GroupDetail
          group={selectedGroup}
          rawToml={rawToml}
          onChange={onChange}
          onCommit={onCommit}
          activeGroup={activeGroup}
          onSetDefault={(id) => {
            const next = setActiveGroup(rawToml, id);
            onChange(next);
            onCommit?.(next);
          }}
          onDelete={(id) => {
            const next = removeGroup(rawToml, id);
            onChange(next);
            onCommit?.(next);
            // 选中回落由上方 reconcile effect 处理。
          }}
          onSaved={setSelectedId}
        />
      </div>
    </section>
  );
}
