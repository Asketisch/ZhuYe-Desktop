/**
 * Vitest — workspaceGroups 纯函数测试（侧边栏项目分组规则）。
 */
import { describe, it, expect } from 'vitest';
import {
  UNASSIGNED_GROUP_KEY,
  groupKeyFor,
  basename,
  isPlaceholderWorkspace,
  groupSessionsByWorkspace,
} from './workspaceGroups';
import type { ReflectSessionInfo } from '@/utils/commands';

function sess(
  id: string,
  startedAt: string,
  workspace?: string | null,
): ReflectSessionInfo {
  return {
    session_id: id,
    model: 'stub/test',
    started_at: startedAt,
    message_count: 1,
    ...(workspace === undefined ? {} : { workspace }),
  };
}

const WS_A = '/Users/me/Code/alpha';
const WS_B = '/Users/me/Code/beta';

const knownWorkspaces = [
  { path: WS_A, label: 'alpha', last_used: 200, session_count: 2 },
  { path: WS_B, label: 'beta', last_used: 100, session_count: 0 },
];

describe('basename', () => {
  it('取末段目录名并容忍结尾斜杠', () => {
    expect(basename('/Users/me/Code/alpha/')).toBe('alpha');
    expect(basename('/Users/me/Code/alpha')).toBe('alpha');
  });
});

describe('isPlaceholderWorkspace', () => {
  it('识别后端空历史兜底占位', () => {
    expect(isPlaceholderWorkspace('/Users/me/.')).toBe(true);
    expect(isPlaceholderWorkspace('.')).toBe(true);
    expect(isPlaceholderWorkspace('/Users/me/Code/alpha')).toBe(false);
  });
});

describe('groupKeyFor', () => {
  it('未归属路径映射到哨兵 key', () => {
    expect(groupKeyFor(null)).toBe(UNASSIGNED_GROUP_KEY);
    expect(groupKeyFor(WS_A)).toBe(WS_A);
  });
});

describe('groupSessionsByWorkspace', () => {
  it('按 workspace 归组，组内按 started_at 倒序', () => {
    const groups = groupSessionsByWorkspace([
      sess('a1', '2026-08-26T10:00:00Z', WS_A),
      sess('a2', '2026-08-27T10:00:00Z', WS_A),
      sess('b1', '2026-08-25T10:00:00Z', WS_B),
    ], knownWorkspaces);

    expect(groups.map((g) => g.path)).toEqual([WS_A, WS_B]);
    expect(groups[0].sessions.map((s) => s.session_id)).toEqual(['a2', 'a1']);
    expect(groups[0].lastActivity).toBe(Date.parse('2026-08-27T10:00:00Z'));
  });

  it('无会话的已知项目也保留（空项目组），跳过兜底占位', () => {
    const groups = groupSessionsByWorkspace([
      sess('a1', '2026-08-27T10:00:00Z', WS_A),
    ], [
      ...knownWorkspaces,
      { path: '/Users/me/.', label: 'default', last_used: 999, session_count: 0 },
    ]);

    expect(groups.map((g) => g.path)).toEqual([WS_A, WS_B]);
    expect(groups[1].sessions).toEqual([]);
    expect(groups[1].label).toBe('beta');
  });

  it('未归属会话进哨兵分组且固定最后', () => {
    const groups = groupSessionsByWorkspace([
      sess('u1', '2026-08-27T12:00:00Z', null),
      sess('u2', '2026-08-20T12:00:00Z'),
      sess('a1', '2026-08-26T10:00:00Z', WS_A),
    ], knownWorkspaces);

    expect(groups[groups.length - 1].key).toBe(UNASSIGNED_GROUP_KEY);
    expect(groups[groups.length - 1].path).toBeNull();
    expect(groups[groups.length - 1].sessions.map((s) => s.session_id)).toEqual(['u1', 'u2']);
  });

  it('有会话组按最近活跃倒序，空组按 last_used 排后', () => {
    const groups = groupSessionsByWorkspace([
      sess('b1', '2026-08-27T10:00:00Z', WS_B),
      sess('a1', '2026-08-26T10:00:00Z', WS_A),
    ], knownWorkspaces);

    // beta 活跃更近 → 排前，尽管其 last_used 更小。
    expect(groups.map((g) => g.path)).toEqual([WS_B, WS_A]);
  });

  it('会话中出现但不在已知项目里的目录也成组（workspaces.json cap 兜底）', () => {
    const groups = groupSessionsByWorkspace([
      sess('c1', '2026-08-27T10:00:00Z', '/Users/me/Code/gamma'),
    ], []);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('gamma');
  });

  it('空输入 + 无已知项目 → 空列表', () => {
    expect(groupSessionsByWorkspace([], [])).toEqual([]);
  });

  it('已移除项目不会因历史会话重新出现', () => {
    const groups = groupSessionsByWorkspace([sess('a1', '2026-08-27T10:00:00Z', WS_A)], [
      { path: WS_A, label: 'alpha', last_used: 1, session_count: 1, hidden: true },
    ]);
    expect(groups).toEqual([]);
  });
});
