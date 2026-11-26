/**
 * KeyHint —— 单个键盘快捷键标签（CSS Modules 版）。
 */
import { shortcutLabel, type Platform } from '@/logic/design-system/utils/keyHints';
import s from '@/render/design-system/primitives/KeyHint.module.css';

export interface KeyHintProps {
  combo: string;
  platform?: Platform;
  label?: string;
}

export function KeyHint({ combo, platform, label }: KeyHintProps) {
  const p = platform ?? 'other';
  return (
    <span className={s.wrap}>
      {label && <span className={s.label}>{label}</span>}
      <kbd className={s.kbd}>{shortcutLabel(combo, p)}</kbd>
    </span>
  );
}
