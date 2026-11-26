/**
 * 设置页套件 —— 分区原语（行卡 / 分组卡 / 控件）与分区注册表。
 *
 * 从 SettingsView.tsx 拆出（500 行预算）：本文件只承载纯展示原语与
 * GROUPS 导航数据，页面壳与分区内容切换仍在 SettingsView.tsx。
 * 视觉规范见 SettingsPage.module.css 头注释。
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, BarChart3, Blocks, Bot, Brain, Cable, ChevronDown, HardDrive,
  Package, Palette, Search, Settings2, SlidersHorizontal, User, WandSparkles, Wrench, X,
} from 'lucide-react';
import type { SettingsSection, SettingsSectionMeta } from '@/contracts/settings/settings';
import kit from './SettingsPage.module.css';

interface SectionDef {
  id: SettingsSection;
  icon: LucideIcon;
  labelKey: string;
  /** 嵌入路由页内容的分区：内容列放开宽度上限。 */
  wide?: boolean;
}

interface GroupDef {
  id: string;
  labelKey: string;
  sections: SectionDef[];
}

export const GROUPS: GroupDef[] = [
  {
    id: 'basics',
    labelKey: 'settingsPage.group.basics',
    sections: [
      { id: 'general', icon: Settings2, labelKey: 'settingsPage.nav.general' },
      { id: 'appearance', icon: Palette, labelKey: 'settingsPage.nav.appearance' },
      { id: 'groups', icon: Package, labelKey: 'settingsPage.nav.models', wide: true },
      { id: 'remote', icon: HardDrive, labelKey: 'settingsPage.nav.remote', wide: true },
    ],
  },
  {
    id: 'agent',
    labelKey: 'settingsPage.group.agent',
    sections: [
      { id: 'personalization', icon: User, labelKey: 'settingsPage.nav.personalization' },
      { id: 'behavior', icon: SlidersHorizontal, labelKey: 'settingsPage.nav.behavior' },
      { id: 'memory', icon: Brain, labelKey: 'settingsPage.nav.memory', wide: true },
      { id: 'agents', icon: Bot, labelKey: 'settingsPage.nav.subagents', wide: true },
      { id: 'plugins', icon: Blocks, labelKey: 'settingsPage.nav.plugins', wide: true },
      { id: 'mcp', icon: Cable, labelKey: 'settingsPage.nav.mcp', wide: true },
      { id: 'skills', icon: WandSparkles, labelKey: 'settingsPage.nav.skills', wide: true },
      { id: 'hooks', icon: Anchor, labelKey: 'settingsPage.nav.hooks', wide: true },
    ],
  },
  {
    id: 'data',
    labelKey: 'settingsPage.group.data',
    sections: [
      { id: 'usage', icon: BarChart3, labelKey: 'settingsPage.nav.usage', wide: true },
      { id: 'advanced', icon: Wrench, labelKey: 'settingsPage.nav.advanced' },
    ],
  },
];

export const ALL_SECTIONS: readonly SettingsSectionMeta[] = GROUPS.flatMap((g) =>
  g.sections.map((sec) => ({ id: sec.id, labelKey: sec.labelKey, groupKey: g.labelKey })),
);

export const SETTINGS_SECTION_META = ALL_SECTIONS;

/* ===== 原语（分区内容共用的行卡 / 控件） ===== */

export function GroupCard({ children }: { children: ReactNode }) {
  return <div className={kit.card}>{children}</div>;
}

export function Row({ label, description, children, wide, detail }: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  detail?: ReactNode;
}) {
  return (
    <div className={kit.row}>
      <div className={kit.rowGrid} data-wide={wide || undefined}>
        <div className={kit.rowText}>
          <div className={kit.rowLabel}>{label}</div>
          {description ? <div className={kit.rowDesc}>{description}</div> : null}
        </div>
        <div className={kit.rowCtl}>{children}</div>
      </div>
      {detail ? <div className={kit.rowDetail}>{detail}</div> : null}
    </div>
  );
}

export function SubHead({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div>
      <h3 className={kit.subHead}>{title}</h3>
      {description ? <p className={kit.subDesc}>{description}</p> : null}
    </div>
  );
}

export function Switch({ on, onChange, disabled, label }: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={kit.switch}
      data-on={on || undefined}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className={kit.thumb} />
    </button>
  );
}

export function Select({ value, onChange, options, label, sm, ariaLabel, disabled }: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  label?: string;
  sm?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <span className={kit.selectWrap} data-sm={sm || undefined}>
      <select
        value={value}
        aria-label={ariaLabel ?? label}
        title={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

export function Badge({ children, fg }: { children: ReactNode; fg?: boolean }) {
  return <span className={kit.badge} data-fg={fg || undefined}>{children}</span>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className={kit.notice}>{children}</div>;
}

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className={kit.emptyBox}>{children}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={kit.toolbar}>{children}</div>;
}

export function SearchBox({ value, onChange, placeholder, ariaLabel }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={kit.searchBox}>
      <Search strokeWidth={1.5} aria-hidden />
      <input
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {value ? (
        <button type="button" className={kit.clearBtn} aria-label="clear" onClick={() => onChange('')}>
          <X strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function CountChip({ children, dim }: { children: ReactNode; dim?: ReactNode }) {
  return (
    <span className={kit.countChip}>
      {children}
      {dim != null ? <span className={kit.dim}>{dim}</span> : null}
    </span>
  );
}

export function Segmented({ value, options, onChange, disabled }: {
  value: string;
  options: Array<{ value: string; label: ReactNode }>;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className={kit.seg} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={kit.segBtn}
          data-active={value === o.value || undefined}
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
