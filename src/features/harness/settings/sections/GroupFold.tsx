/**
 * GroupFold —— 模型组详情面板的本地折叠区。
 *
 * 切片内实现,不跨切片引 messages/Collapsible:折叠头(chevron + 标签)
 * + 展开体,开合态为组件本地 UI 状态。从 GroupDetail.tsx 拆出,使其
 * 行数回到 file-size-budget 预算内。
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import s from '@/render/harness/settings/SettingsView.module.css';

export function GroupFold({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.gFold}>
      <button
        type="button"
        className={s.gFoldHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={ChevronDown} size={13} className={s.gFoldChevron} />
        <span>{label}</span>
      </button>
      {open && <div className={s.gFoldBody}>{children}</div>}
    </div>
  );
}
