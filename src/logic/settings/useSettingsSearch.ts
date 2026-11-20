/**
 * 设置页分区搜索弹层状态（⌘K 唤起 + Esc 关闭）。
 *
 * 状态与 window 键盘监听住在 logic 层（渲染层边界禁止 hooks / window /
 * i18n 依赖，见 scripts/check-render-boundaries.mjs）。结果过滤不在这里
 * 做 —— 注册表数据住在渲染层（settingsKit），logic 依赖界面资源会被
 * 依赖方向门禁拦下；渲染层拿到 query 后用普通表达式自行过滤。
 */
import { useEffect, useState } from 'react';
import type { SettingsSection } from '@/contracts/settings';

export interface SettingsSearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  /** 选中搜索结果：执行跳转回调并收起弹层。 */
  jump: (id: SettingsSection) => void;
}

export function useSettingsSearch(
  onJump: (id: SettingsSection) => void,
): SettingsSearchState {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // ⌘K / Ctrl+K 唤起分区搜索；弹层打开时 Esc 关闭（页面级 Esc 关闭由宿主负责）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const jump = (id: SettingsSection) => {
    setOpen(false);
    setQuery('');
    onJump(id);
  };

  return { open, setOpen, query, setQuery, jump };
}
