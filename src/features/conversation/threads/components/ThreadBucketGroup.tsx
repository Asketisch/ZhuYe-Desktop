/**
 * ThreadBucketGroup —— 单个时间分桶（CSS Modules 版）。
 *
 * B3-03: 透传 rename / delete / export / archive handlers 到 ThreadItem。
 */
import type { SessionBucket } from '@/features/conversation/sessions';
import { ThreadItem } from './ThreadItem';
import s from '@/render/threads/components/ThreadBucketGroup.module.css';

export interface ThreadBucketGroupProps {
  bucket: SessionBucket;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<string | null>;
  /** fork 历史会话为子会话（可选）；透传给 ThreadItem。 */
  onFork?: (id: string, branch: string) => Promise<string>;
  onArchive?: (id: string) => Promise<void>;
  onGenerateTitle?: (id: string) => Promise<string>;
  /** 多选删除：勾选框渲染与选中集合（可选）。 */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function ThreadBucketGroup({
  bucket,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onExport,
  onFork,
  onArchive,
  onGenerateTitle,
  selectable,
  selectedIds,
  onToggleSelect,
}: ThreadBucketGroupProps) {
  return (
    <section className={s.group} data-bucket={bucket.label}>
      <h3 className={s.label}>{bucket.label}</h3>
      <ul className={s.items}>
        {bucket.sessions.map((sess) => (
          <ThreadItem
            key={sess.session_id}
            session={sess}
            active={activeId === sess.session_id}
            onClick={() => onSelect(sess.session_id)}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onFork={onFork}
            onArchive={onArchive}
            onGenerateTitle={onGenerateTitle}
            selectable={selectable}
            selected={selectedIds?.has(sess.session_id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </ul>
    </section>
  );
}
