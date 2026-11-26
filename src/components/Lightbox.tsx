/**
 * Lightbox —— 图片放大预览(B4)。
 *
 * Markdown 图片与聊天附件缩略图共用的点击放大层:暗色遮罩 + 图片
 * contain 适配(Esc / 点击遮罩 / 关闭按钮退出)。纯展示,无焦点陷阱
 * (图片无可交互子元素),但保留 dialog 语义与焦点还原。
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Icon, IconButton } from '@/features/harness/design-system';
import s from './Lightbox.module.css';

export function Lightbox({ src, onClose, alt }: { src: string | null; onClose: () => void; alt?: string }) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!src) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [src, onClose]);

  if (!src) return null;
  return (
    <div
      className={s.overlay}
      data-testid="lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={alt ?? 'image preview'} className={s.frame}>
        <img src={src} alt={alt ?? ''} className={s.image} data-testid="lightbox-image" />
        <div className={s.closeBtn}>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <Icon icon={X} size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
