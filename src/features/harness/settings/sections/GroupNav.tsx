/**
 * 模型组左列表 —— 主从布局的「主」列。
 *
 * 每项 = 展示名首字 monogram 头像 + 展示名 + 线格式/凭据数元信息 +
 * 凭据池健康点（`zhuye_credential_pool_status`，随组集合签名变化重查，
 * 与 Inspector 的池状态共享同一 query 前缀）。点击即选中 —— 选中就是
 * 在右侧详情中编辑（替代旧「组卡片 + 编辑按钮」两层结构）。
 */
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_credential_pool_status } from '@/utils/commands';
import { groupDisplayLabel, type GroupEntry } from '@/logic/settings/config/groups';
import { ProviderAvatar } from './ProviderAvatar';
import s from '@/render/harness/settings/SettingsView.module.css';

export interface GroupNavProps {
  groups: GroupEntry[];
  /** 当前默认组（`[active].group`）。 */
  activeId: string | null;
  /** 选中（正在详情中编辑）的组 id。 */
  selectedId: string | null;
  /** 凭据池健康查询签名 —— 组集合 / 凭据数变化时换 key 触发重查。 */
  poolSignature: string;
  onSelect: (id: string) => void;
}

export function GroupNav({ groups, activeId, selectedId, poolSignature, onSelect }: GroupNavProps) {
  const { t } = useI18n();
  const poolQuery = useQuery({
    queryKey: ['credential-pool-status', poolSignature],
    queryFn: () => zhuye_credential_pool_status(),
    staleTime: 15_000,
  });
  const pools = poolQuery.data ?? [];

  return (
    <nav className={s.gNavList} data-testid="groups-nav" aria-label={t('settings.groups.title')}>
      {groups.map((group) => {
        const label = groupDisplayLabel(group);
        const pool = pools.find((p) => p.group === group.id) ?? null;
        // 健康点:绿 = 池全可用;橙 = 有冷却中凭据;灰 = 无池信息(组内无凭据 / 查询中)。
        const dotState = pool == null ? 'none' : pool.healthy >= pool.total ? 'ok' : 'cooling';
        return (
          <button
            key={group.id}
            type="button"
            className={s.gNavItem}
            data-active={group.id === selectedId || undefined}
            data-testid={`group-edit-${group.id}`}
            title={group.baseUrl || undefined}
            onClick={() => onSelect(group.id)}
          >
            <ProviderAvatar
              group={group}
              letter={(label.trim()[0] ?? '?').toUpperCase()}
            />
            <span className={s.gNavItemMain}>
              <span className={s.gNavItemName}>
                {label}
                {group.id === activeId && (
                  <Badge variant="success" solid>
                    {t('settings.groups.defaultBadge')}
                  </Badge>
                )}
              </span>
              <span className={s.gNavItemMeta}>
                {group.endpoint}
                {' · '}
                <span data-testid={`group-credential-count-${group.id}`}>
                  {t('settings.groups.credentialCount', { count: group.credentials.length })}
                </span>
              </span>
            </span>
            <span
              className={s.gNavDot}
              data-state={dotState}
              title={
                pool == null
                  ? t('settings.groups.poolNone')
                  : pool.healthy >= pool.total
                    ? t('settings.groups.poolOk')
                    : t('settings.groups.poolCooling', { count: String(pool.total - pool.healthy) })
              }
            />
          </button>
        );
      })}
      {groups.length === 0 && <p className={s.gNavEmpty}>{t('settings.groups.empty')}</p>}
    </nav>
  );
}
