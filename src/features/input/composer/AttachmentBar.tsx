/**
 * AttachmentBar —— Composer 底部附件预览条 (B5 + A3 状态机)。
 *
 * 显示当前待发的 attachments(inline image / file mention / skill mention /
 * 浏览器字节流文件)。inline image 渲染真实**缩略图**（data-URL 直接作
 * `<img src>`）,其余为文字 chip。每个 chip 有 "×" 按钮删除;浏览器文件
 * 落盘中转圈(pending)、失败红框并提供重试(A1 上传管线)。
 */
import { AlertCircle, RotateCw } from 'lucide-react';
import { Icon, Spinner } from '@/features/harness/design-system';
import type { StagedAttachment } from '@/logic/composer/useAttachments';
import s from '@/render/composer/AttachmentBar.module.css';

export interface AttachmentBarProps {
  attachments: StagedAttachment[];
  onRemove: (idx: number) => void;
  /** A3:失败附件重试(仅 browser_file)。 */
  onRetry?: (id: string) => void;
}

export function AttachmentBar({ attachments, onRemove, onRetry }: AttachmentBarProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={s.bar} data-testid="attachment-bar">
      {attachments.map((a, idx) => {
        const removeBtn = (
          <button
            type="button"
            className={s.remove}
            aria-label="Remove attachment"
            data-testid={`attachment-remove-${idx}`}
            onClick={() => onRemove(idx)}
          >
            ×
          </button>
        );
        if (a.attachment.kind === 'image') {
          return (
            <div
              key={a.id}
              className={s.chip}
              data-status={a.status}
              data-testid="attachment-image-chip"
            >
              <img
                className={s.thumb}
                src={a.attachment.data}
                alt={a.attachment.mime_type}
                title={a.attachment.mime_type}
                data-testid="attachment-thumb"
              />
              <span className={s.label}>{shorten(a.attachment.mime_type)}</span>
              {removeBtn}
            </div>
          );
        }
        const label =
          a.attachment.kind === 'local_image'
            ? `🖼 ${shorten(a.attachment.path)}`
            : a.attachment.kind === 'skill'
              ? `⚡ /${a.attachment.name}`
              : a.attachment.kind === 'browser_file'
                ? `📄 ${shorten(a.attachment.path)}`
                : `📄 ${shorten(a.attachment.path)}${a.attachment.range ? ` L${a.attachment.range.start_line}-${a.attachment.range.end_line}` : ''}`;
        return (
          <div
            key={a.id}
            className={s.chip}
            data-status={a.status}
            data-testid="attachment-file-chip"
          >
            <span className={s.label}>{label}</span>
            {a.status === 'pending' && <Spinner size={10} />}
            {a.status === 'error' && (
              <>
                <Icon icon={AlertCircle} size={12} className={s.errorIcon} />
                {onRetry && (
                  <button
                    type="button"
                    className={s.retry}
                    aria-label="Retry upload"
                    data-testid={`attachment-retry-${idx}`}
                    onClick={() => onRetry(a.id)}
                  >
                    <Icon icon={RotateCw} size={11} />
                  </button>
                )}
              </>
            )}
            {removeBtn}
          </div>
        );
      })}
    </div>
  );
}

function shorten(p: string): string {
  if (p.length <= 28) return p;
  return `…${p.slice(p.length - 26)}`;
}
