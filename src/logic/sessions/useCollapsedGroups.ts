/**
 * useCollapsedGroups —— 侧边栏项目分组折叠状态（localStorage 持久化）。
 *
 * - key 为 `groupKeyFor(path)`（项目绝对路径 / 未归属哨兵）。
 * - 默认全部展开，未归属分组默认折叠（旧会话不应抢占视觉焦点）。
 * - localStorage 读写失败（隐私模式等）静默降级为内存态。
 */
import { useCallback, useState } from 'react';
import { UNASSIGNED_GROUP_KEY } from './workspaceGroups';

const STORAGE_KEY = 'reflect.sidebar.collapsedGroups';

function load(): Set<string> {
  const defaults = new Set([UNASSIGNED_GROUP_KEY]);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return defaults;
  }
}

export interface UseCollapsedGroupsResult {
  /** 折叠中的分组 key 集合。 */
  collapsed: Set<string>;
  /** 切换某分组的折叠态并持久化。 */
  toggle: (key: string) => void;
  /** 该分组当前是否折叠。 */
  isCollapsed: (key: string) => boolean;
}

export function useCollapsedGroups(): UseCollapsedGroupsResult {
  const [collapsed, setCollapsed] = useState<Set<string>>(load);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // 持久化失败仅影响下次启动的默认展开态，不打断交互。
      }
      return next;
    });
  }, []);

  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed]);

  return { collapsed, toggle, isCollapsed };
}
