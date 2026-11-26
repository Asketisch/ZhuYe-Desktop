/**
 * Workspace 分组工具 —— 侧边栏按项目目录分组规则。
 *
 * 纯函数，便于测试与跨 feature 复用。
 * 时间分桶（buckets.ts）仍服务于 HomeView / ThreadsView；侧边栏用本项目录分组。
 */
import type { ZhuyeSessionInfo, ZhuyeWorkspaceInfo } from '@/utils/commands';

/** 未归属分组（旧会话 / CLI 创建，`workspace` 为空）的哨兵 key。 */
export const UNASSIGNED_GROUP_KEY = '@@unassigned';

/** 带子代理会话的会话行 —— `children` 非空 = 有子代理（v1.12 血缘）。 */
export type SessionWithChildren = ZhuyeSessionInfo & {
  /** 子代理会话（`parent_session_id` 指向本会话），`started_at` 倒序。 */
  children?: ZhuyeSessionInfo[];
};

export interface WorkspaceSessionGroup {
  /** 项目目录绝对路径；null = 未归属分组。 */
  path: string | null;
  /** 折叠状态持久化用稳定 key（`path` 或未归属哨兵）。 */
  key: string;
  /** 显示名：目录 basename；未归属分组为空串（由 UI 用 i18n 文案渲染）。 */
  label: string;
  /** 组内会话，`started_at` 倒序；子代理会话挂在其父会话 `children` 下，
   * 不在本数组出现（顶层列表只留主会话，minimax code 形态）。 */
  sessions: SessionWithChildren[];
  /** 组内最近会话的 started_at（毫秒）；空项目组为 0。 */
  lastActivity: number;
}

/** 分组 key：项目绝对路径，未归属用哨兵。 */
export function groupKeyFor(path: string | null): string {
  return path ?? UNASSIGNED_GROUP_KEY;
}

/** 目录绝对路径 → 末段目录名（显示用）。 */
export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * 后端 `zhuye_list_workspaces` 空历史的兜底占位（`$HOME/.`，label "default"）。
 * 不是真实项目目录，不进侧边栏。
 * v1.x 修复:根目录 "/" 同样是占位（历史 json 里出现过的无效条目），一并过滤。
 */
export function isPlaceholderWorkspace(path: string): boolean {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.endsWith('/.') || trimmed.endsWith('\\.') || trimmed === '.' || trimmed === '';
}

function startedAtMs(session: ZhuyeSessionInfo): number {
  const t = Date.parse(session.started_at);
  return Number.isNaN(t) ? 0 : t;
}

function sortByRecency(sessions: ZhuyeSessionInfo[]): ZhuyeSessionInfo[] {
  return [...sessions].sort((a, b) => startedAtMs(b) - startedAtMs(a));
}

/**
 * 全量会话 + 已知项目 → 项目分组列表。
 *
 * - 无消息的空会话（仅 SessionMeta 头，如旧版「新建即保存」的遗留壳）
 *   不进侧栏 —— 避免一排 8 位 ID 名的空壳条目；
 * - 会话按 `workspace` 精确归组；无归属或占位路径（`.` 等，见
 *   `isPlaceholderWorkspace`）→ 未归属分组（固定最后）。
 * - 已知项目（workspaces.json 历史，cap 20 条）即使无会话也保留，
 *   便于直接在该项目下新建会话；同时并集会话中出现过的目录
 *   （workspaces.json 可能被 cap 挤出的路径）。
 * - 有会话的组按最近活跃倒序；空项目组排在其后按 last_used 倒序；
 *   未归属分组固定最后。
 */
export function groupSessionsByWorkspace(
  sessions: ZhuyeSessionInfo[],
  knownWorkspaces: ZhuyeWorkspaceInfo[] = [],
): WorkspaceSessionGroup[] {
  // 空会话(无消息)不进侧栏;磁盘记录不动,Threads 页时间桶不受影响。
  sessions = sessions.filter((s) => s.message_count > 0);
  // v1.12:先把子代理会话挂到父会话 `children` 下(顶层只留主会话)。
  // 父不在本批(被删/归档/列表过滤)的孤儿子会话按顶层处理 —— 不静默丢。
  const parentIds = new Set(
    sessions.flatMap((s) => (s.parent_session_id ? [s.parent_session_id] : [])),
  );
  const childrenByParent = new Map<string, ZhuyeSessionInfo[]>();
  const topLevel: ZhuyeSessionInfo[] = [];
  for (const s of sessions) {
    const parent = s.parent_session_id;
    if (parent && parentIds.has(parent)) {
      const arr = childrenByParent.get(parent);
      if (arr) arr.push(s);
      else childrenByParent.set(parent, [s]);
    } else {
      topLevel.push(s);
    }
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  }
  const withChildren = (s: ZhuyeSessionInfo): SessionWithChildren => {
    const children = childrenByParent.get(s.session_id);
    return children ? { ...s, children } : s;
  };
  sessions = topLevel.map(withChildren);
  const hidden = new Set(knownWorkspaces.filter((ws) => ws.hidden).map((ws) => ws.path));
  // 占位工作区(. / $HOME/. 等)不是真实项目目录,会话归入未归属组。
  const groupKeyOf = (s: ZhuyeSessionInfo): string =>
    s.workspace && !isPlaceholderWorkspace(s.workspace) ? s.workspace : UNASSIGNED_GROUP_KEY;
  const byPath = new Map<string, ZhuyeSessionInfo[]>();
  for (const s of sessions) {
    if (s.workspace && hidden.has(s.workspace)) continue;
    const key = groupKeyOf(s);
    const arr = byPath.get(key);
    if (arr) arr.push(s);
    else byPath.set(key, [s]);
  }

  const lastUsedByPath = new Map<string, number>();
  const labelByPath = new Map<string, string>();
  for (const ws of knownWorkspaces) {
    if (ws.hidden) continue;
    if (isPlaceholderWorkspace(ws.path)) continue;
    lastUsedByPath.set(ws.path, ws.last_used);
    if (ws.label) labelByPath.set(ws.path, ws.label);
  }
  for (const s of sessions) {
    if (s.workspace && hidden.has(s.workspace)) continue;
    // 占位路径不建组,否则侧栏会出现「.」这样的裸目录名。
    if (!s.workspace || isPlaceholderWorkspace(s.workspace)) continue;
    if (!lastUsedByPath.has(s.workspace)) lastUsedByPath.set(s.workspace, 0);
    if (!labelByPath.has(s.workspace)) labelByPath.set(s.workspace, basename(s.workspace));
  }

  const groups: WorkspaceSessionGroup[] = [];
  for (const [path] of lastUsedByPath) {
    const groupSessions = sortByRecency(byPath.get(path) ?? []);
    groups.push({
      path,
      key: groupKeyFor(path),
      label: labelByPath.get(path) ?? basename(path),
      sessions: groupSessions,
      lastActivity: groupSessions.length > 0 ? startedAtMs(groupSessions[0]) : 0,
    });
  }
  groups.sort((a, b) => {
    const aActive = a.lastActivity > 0;
    const bActive = b.lastActivity > 0;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) return b.lastActivity - a.lastActivity;
    return (lastUsedByPath.get(b.path ?? '') ?? 0) - (lastUsedByPath.get(a.path ?? '') ?? 0);
  });

  const unassigned = byPath.get(UNASSIGNED_GROUP_KEY);
  if (!unassigned) return groups;
  const unassignedSessions = sortByRecency(unassigned);
  return [
    ...groups,
    {
      path: null,
      key: UNASSIGNED_GROUP_KEY,
      label: '',
      sessions: unassignedSessions,
      lastActivity: startedAtMs(unassignedSessions[0]),
    },
  ];
}
