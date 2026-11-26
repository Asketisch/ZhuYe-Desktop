/**
 * UserAttachments —— 用户消息附件行(A2)。
 *
 * 渲染 `user_attachments` TurnItem:图片 96px 缩略图(点击 Lightbox 放大)
 * + 文件 chip(FileText 图标 + basename + 行区间)。与用户气泡同属右对齐
 * 视觉组;live 提交与回放两条数据路径在此汇合(见 turns.ts / replay.ts)。
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { Lightbox } from '@/components/Lightbox';
import type { UserAttachmentMeta } from '@/stores/agent/types';
import s from '@/render/messages/UserAttachments.module.css';

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function UserAttachments({ attachments }: { attachments: UserAttachmentMeta[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  if (attachments.length === 0) return null;
  return (
    <div className={s.row} data-testid="user-attachments">
      {attachments.map((att, i) =>
        att.kind === 'image' ? (
          <button
            key={i}
            type="button"
            className={s.thumbBtn}
            onClick={() => setPreview(att.src)}
            data-testid={`user-attachment-image-${i}`}
            aria-label="放大图片"
            title={att.source}
          >
            <img src={att.src} alt={att.mime} className={s.thumb} />
          </button>
        ) : (
          <span key={i} className={s.fileChip} data-testid={`user-attachment-file-${i}`} title={att.path}>
            <Icon icon={FileText} size={12} />
            <span className={s.fileName}>{basename(att.path)}</span>
            {att.range && (
              <span className={s.fileRange}>
                L{att.range.start_line}-L{att.range.end_line}
              </span>
            )}
          </span>
        ),
      )}
      <Lightbox src={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
