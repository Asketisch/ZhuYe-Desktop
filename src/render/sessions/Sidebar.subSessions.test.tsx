/**
 * harness 侧栏子会话区测试 —— 父行折叠开关与子会话行点击行为。
 *
 * 直接挂载渲染层 Sidebar（逻辑层状态以 props 注入,渲染层禁 hook）:
 * - 子会话行点击 → onSelectSub(父 id, 子 id)（只读查看器入口）,
 *   无 onSelectSub 的旧宿主回退 onSelect(父 id);
 * - 折叠 chevron 点击 → toggleCollapse(父 id),collapsed 集合在场时
 *   子会话块整块隐藏(开关自身保留)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, saveLocale } from '@/utils/i18n';
import type { SidebarViewProps } from '@/contracts/sidebar';
import { Sidebar } from './Sidebar';

const PARENT = { session_id: 'parent-1', started_at: '2026-11-22T10:00:00Z', title: '主会话' };
const KID_A = { session_id: 'kid-a', started_at: '2026-11-22T10:01:00Z', title: '子代理 A' };
const KID_B = { session_id: 'kid-b', started_at: '2026-11-22T10:02:00Z', title: '子代理 B' };

interface MountOverrides {
  onSelectSub?: SidebarViewProps['onSelectSub'];
  collapsedIds?: string[];
  toggleCollapse?: (sessionId: string) => void;
}

function mount(overrides: MountOverrides = {}) {
  const onSelect = vi.fn();
  const props: SidebarViewProps = {
    t: ((key: string, vars?: Record<string, string>) =>
      key === 'harness.sb.subExpand' && vars ? `expand ${vars.n}` : key) as SidebarViewProps['t'],
    groups: [],
    loading: false,
    error: null,
    activeId: null,
    currentWorkspace: null,
    query: '',
    searching: false,
    pinnedGroup: null,
    filtered: [
      {
        path: '',
        key: 'ws',
        label: 'WS',
        lastActivity: 0,
        sessions: [{ ...PARENT, children: [KID_A, KID_B] } as never],
      },
    ],
    showEmpty: false,
    hasSelectableSessions: false,
    selectMode: false,
    selectedIds: new Set(),
    archivedOpen: false,
    menuFor: null,
    onOpenMenu: vi.fn(),
    menuActions: [],
    SessionMenu: () => null,
    renameId: null,
    renameValue: '',
    onRenameValueChange: vi.fn(),
    onSubmitRename: vi.fn(),
    onCancelRename: vi.fn(),
    searchOpen: false,
    onToggleSearch: vi.fn(),
    pendingOnly: false,
    onTogglePendingOnly: vi.fn(),
    elapsedNow: Date.now(),
    isCollapsed: () => false,
    onSelect,
    onSelectSub: overrides.onSelectSub,
    onToggleGroup: vi.fn(),
    onQueryChange: vi.fn(),
    onEnterSelect: vi.fn(),
    onExitSelect: vi.fn(),
    onDeleteSelected: vi.fn(),
    onToggleSelect: vi.fn(),
    onToggleArchived: vi.fn(),
    onNewChat: vi.fn(),
    onRefresh: vi.fn(),
    subSessionsFold: {
      expanded: new Set<string>(),
      toggle: vi.fn(),
      collapsed: new Set(overrides.collapsedIds ?? []),
      toggleCollapse: overrides.toggleCollapse ?? vi.fn(),
    },
  } as unknown as SidebarViewProps;
  const view = render(<I18nProvider><Sidebar {...props} /></I18nProvider>);
  return { onSelect, unmount: view.unmount };
}

describe('侧栏子会话区（折叠开关 + 子会话行点击）', () => {
  beforeEach(() => saveLocale('en'));

  it('子会话行点击走 onSelectSub(父 id, 子 id)', () => {
    const onSelectSub = vi.fn();
    const { onSelect } = mount({ onSelectSub });
    fireEvent.click(screen.getByTestId('harness-subsession-kid-a'));
    expect(onSelectSub).toHaveBeenCalledWith('parent-1', 'kid-a');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('无 onSelectSub 的旧宿主回退 onSelect(父 id)', () => {
    const { onSelect } = mount({});
    fireEvent.click(screen.getByTestId('harness-subsession-kid-b'));
    expect(onSelect).toHaveBeenCalledWith('parent-1');
  });

  it('折叠开关隐藏子会话块,但开关自身保留', () => {
    mount({ collapsedIds: ['parent-1'] });
    expect(screen.queryByTestId('sub-sessions-parent-1')).toBeNull();
    expect(screen.queryByTestId('harness-subsession-kid-a')).toBeNull();
    expect(screen.getByTestId('sub-toggle-parent-1')).toBeTruthy();
  });

  it('未折叠时子会话块在场,开关点击触发 toggleCollapse(父 id)', () => {
    const toggleCollapse = vi.fn();
    const { unmount } = mount({ toggleCollapse });
    expect(screen.getByTestId('sub-sessions-parent-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sub-toggle-parent-1'));
    expect(toggleCollapse).toHaveBeenCalledWith('parent-1');
    unmount();
  });
});
