/**
 * 模型组列表（`[[model_group]]` 条目卡片）。
 *
 * 每张卡片展示组的展示名 / 线格式 / 组内凭据数 / 默认模型 / 端点地址，
 * 并提供「编辑」「删除」两个入口 —— 编辑把整组（含组内凭据）载入表单，
 * 删除连带清掉该组的嵌套凭据表。
 */
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  groupDisplayLabel,
  maskKey,
  type GroupEntry,
} from '../config/groups';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupListProps {
  groups: GroupEntry[];
  onEdit: (group: GroupEntry) => void;
  onDelete: (group: GroupEntry) => void;
}

export function GroupList({ groups, onEdit, onDelete }: GroupListProps) {
  const { t } = useI18n();
  return (
    <div className={s.providerFields}>
      {groups.map((group) => (
        <div key={group.id} className={s.providerCard}>
          <div className={s.providerHeader}>
            <span className={s.providerName}>{groupDisplayLabel(group)}</span>
            <Badge variant="info">{group.endpoint}</Badge>
            {group.responsesApi && <Badge variant="neutral">responses</Badge>}
            <Badge variant="neutral" data-testid={`group-credential-count-${group.id}`}>
              {t('settings.groups.credentialCount', { count: group.credentials.length })}
            </Badge>
          </div>
          <div className={s.planMeta}>
            {group.apiKey ? (
              <code>{maskKey(group.apiKey)}</code>
            ) : (
              <Badge variant="neutral">{t('settings.groups.keylessBadge')}</Badge>
            )}
            {group.model && <span>{group.model}</span>}
            {group.baseUrl && <span className={s.planUrl}>{group.baseUrl}</span>}
          </div>
          <div className={s.planActions}>
            <Button variant="ghost" size="sm" onClick={() => onEdit(group)} data-testid={`group-edit-${group.id}`}>
              <Icon icon={RefreshCw} size={12} /> {t('settings.groups.edit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(group)} data-testid={`group-delete-${group.id}`}>
              {t('settings.groups.delete')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
