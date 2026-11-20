/**
 * SettingsHost —— 设置页宿主。
 *
 * 设置页是全屏覆盖层（`SettingsPage.module.css` 的 `.page` 固定铺满窗口，
 * 两栏栅格布局）；本宿主只负责开闭与 Esc 关闭，表单内容整体复用
 * SettingsView（配置 schema / sections / 保存链路零改动）。
 * 打开入口：侧栏用户条 ⋯、「更多」菜单、⌘, 快捷键。
 */
import { useEffect } from 'react';
import { SettingsView } from '@/features/settings/SettingsView';

export function SettingsHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return <SettingsView onClose={onClose} />;
}
