/**
 * Vitest — 会话置顶（pins）纯函数 + 侧边栏置顶区。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { isPinned, readPins, resetPinsForTests, togglePin, unpin, useSessionPins } from '@/logic/conversation/sessions/pins';
import type { WorkspaceSessionGroup } from '@/logic/conversation/sessions/workspaceGroups';
import { Sidebar } from '@/features/conversation/sessions/components/Sidebar';

beforeEach(() => {
  window.localStorage.clear();
  resetPinsForTests();
});

describe('pins utils', () => {
  it('toggles pin state and preserves order', () => {
    expect(readPins()).toEqual([]);
    expect(togglePin('a')).toBe(true);
    expect(togglePin('b')).toBe(true);
    // 取消置顶移除，重新置顶追加在尾部（置顶顺序 = 操作顺序）。
    expect(togglePin('a')).toBe(false);
    expect(readPins()).toEqual(['b']);
    expect(togglePin('a')).toBe(true);
    expect(readPins()).toEqual(['b', 'a']);
    expect(isPinned('a')).toBe(true);
    expect(togglePin('b')).toBe(false);
    expect(readPins()).toEqual(['a']);
  });

  it('unpin removes dangling references', () => {
    togglePin('a');
    unpin('a');
    unpin('missing'); // 幂等
    expect(readPins()).toEqual([]);
  });
});

function sess(id: string, title?: string) {
  return {
    session_id: id,
    model: 'stub/test',
    started_at: new Date().toISOString(),
    message_count: 2,
    ...(title ? { title } : {}),
  };
}

const groupA: WorkspaceSessionGroup = {
  path: '/Users/me/Code/alpha',
  key: '/Users/me/Code/alpha',
  label: 'alpha',
  sessions: [sess('s1', 'Fix login bug'), sess('s2', 'Explore codebase')],
  lastActivity: Date.now(),
};

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <I18nProvider>
      <Sidebar
        groups={[groupA]}
        loading={false}
        error={null}
        activeId={null}
        currentWorkspace="/Users/me/Code/alpha"
        onSelect={() => {}}
        onRefresh={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('Sidebar pinned section', () => {
  it('renders pinned sessions on top exactly once', () => {
    renderSidebar({ pinnedIds: ['s1'], onTogglePin: () => {} });
    expect(screen.getByText('Pinned')).toBeDefined();
    // 置顶会话渲染在置顶区，且全列表只有一行（去重）。
    expect(screen.getByTestId('harness-session-s1')).toBeDefined();
    expect(screen.getAllByText('Fix login bug')).toHaveLength(1);
  });

  it('hides pinned section when nothing is pinned', () => {
    renderSidebar({});
    expect(screen.queryByText('Pinned')).toBeNull();
  });

  it('archived list is no longer part of the sidebar (moved to /sessions)', () => {
    renderSidebar({
      archived: [sess('arch-1', 'Old work')],
      onUnarchive: async () => {},
      onDelete: async () => {},
      onExport: async () => null,
      onRename: async () => {},
    });
    // v3 设计把归档区从侧栏移除（由 /sessions 页承载），这里锁定该契约。
    expect(screen.queryByTestId('sidebar-archived')).toBeNull();
    expect(screen.queryByText('Old work')).toBeNull();
  });
});

describe('useSessionPins hook', () => {
  it('mirrors toggles via the subscription', async () => {
    const probe: string[][] = [];
    function Probe() {
      const { pinnedIds, toggle } = useSessionPins();
      probe.push(pinnedIds);
      return <button onClick={() => toggle('x')} data-testid="probe-toggle" />;
    }
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId('probe-toggle'));
    expect(probe[probe.length - 1]).toEqual(['x']);
  });
});
