/**
 * TurnDiffReview —— 「审查」按钮 + 就地展开的单文件 diff 预览。
 *
 * v1.13:改动卡每个文件行的「审查」入口。展开方式选**就地浮层**而非
 * 右侧 dock:
 * - diff 正文已经在手(工具输出的 `metadata.diff`),不需要额外 IPC;
 * - 避免与 `prefs.chatDiffSplit` 的**工作区** diff 面板混淆(那是
 *   `git diff` 的全量视图,语义不同);
 * - ZCode 之所以开 side pane,是它的改动明细要 RPC 拉取且带 patch 校验;
 *   我们本地已有完整 unified diff,就地展开更直接。
 *
 * 浮层用 `position: fixed` 逃逸消息流的滚动裁剪,坐标按视口量测
 * (与 `ComposerPlusMenu` 的飞出面板同款口径)。
 */
import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { DiffViewer } from '@/features/workbench/git/DiffViewer';
import { useI18n } from '@/utils/i18n';
import s from '@/render/conversation/messages/TurnChangesCard.module.css';

export interface TurnDiffReviewProps {
  /** 目标文件路径（浮层标题）。 */
  path: string;
  /** 该文件的 unified diff 正文（空串 = 无 diff 可看）。 */
  diff: string;
}

const FLY_W = 520;
const GAP = 8;
const MARGIN = 8;
const FLY_H_CAP = 420;

export function TurnDiffReview({ path, diff }: TurnDiffReviewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  /** 展开时定位浮层:锚在按钮右侧,放不下翻左侧,纵向钳到视口内。 */
  const openFlyout = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    let left = rect.right + GAP;
    if (left + FLY_W > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, rect.left - FLY_W - GAP);
    }
    let top = rect.top;
    if (top + FLY_H_CAP > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, window.innerHeight - FLY_H_CAP - MARGIN);
    }
    setPos({ top: Math.round(top), left: Math.round(left) });
  };

  // 点外部 / Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 无 diff 正文时不给「审查」入口(工具改了文件但没产出 diff)。
  if (!diff.trim()) return null;

  return (
    <span className={s.reviewWrap} ref={wrapRef}>
      <button
        type="button"
        className={s.reviewBtn}
        aria-expanded={open}
        title={t('turnChanges.review')}
        data-testid="turn-change-review"
        onClick={(e) => {
          if (open) {
            setOpen(false);
            return;
          }
          openFlyout(e.currentTarget);
          setOpen(true);
        }}
      >
        <Icon icon={Eye} size={12} />
        <span>{t('turnChanges.review')}</span>
      </button>
      {open && (
        <div
          className={s.reviewFlyout}
          data-testid="turn-diff-review"
          style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : undefined}
        >
          <div className={s.reviewHead} title={path}>{path}</div>
          <div className={s.reviewBody}>
            <DiffViewer diff={diff} path={path} emptyMessage={t('turnChanges.noDiff')} />
          </div>
        </div>
      )}
    </span>
  );
}
