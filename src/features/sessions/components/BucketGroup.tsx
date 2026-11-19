/**
 * BucketGroup —— 单个时间分桶（CSS Modules 版）。
 */
import type { SessionBucket } from '../utils/buckets';
import { SessionItem } from './SessionItem';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import s from '@/render/sessions/components/BucketGroup.module.css';

export interface BucketGroupProps {
  bucket: SessionBucket;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** 行级操作（可选）；透传给 SessionItem 的 kebab 菜单。 */
  onRename?: (id: string, newName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<string | null>;
  onArchive?: (id: string) => Promise<void>;
}

/** 内部 label → i18n key。 */
const BUCKET_LABEL_KEYS: Record<string, LocaleKey> = {
  'Now': 'sidebar.bucket.now',
  'Today': 'sidebar.bucket.today',
  'Yesterday': 'sidebar.bucket.yesterday',
  'This week': 'sidebar.bucket.thisWeek',
  'Older': 'sidebar.bucket.older',
};

export function BucketGroup({
  bucket,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onExport,
  onArchive,
}: BucketGroupProps) {
  const { t } = useI18n();
  const labelKey = BUCKET_LABEL_KEYS[bucket.label];
  return (
    <section className={s.group}>
      <h4 className={s.label}>{labelKey ? t(labelKey) : bucket.label}</h4>
      <div className={s.items}>
        {bucket.sessions.map((sess) => (
          <SessionItem
            key={sess.session_id}
            session={sess}
            active={activeId === sess.session_id}
            onClick={() => onSelect(sess.session_id)}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onArchive={onArchive}
          />
        ))}
      </div>
    </section>
  );
}
