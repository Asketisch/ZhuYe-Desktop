/**
 * pins —— 会话置顶（localStorage 持久化 + pub/sub）。
 *
 * 置顶是本机 UI 组织偏好（对标 ZCode 侧边栏「已置顶」区），不入后端
 * 会话元数据：localStorage `reflect.sessionPins.v1` 存有序 id 列表
 * （置顶顺序即展示顺序）。跨设备同步留待账号体系。
 */
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'reflect.sessionPins.v1';
const listeners = new Set<() => void>();
let cached: string[] | null = null;

function load(): string[] {
  if (cached !== null) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    cached = [];
  }
  return cached;
}

function persist(next: string[]): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时静默 */
  }
  for (const fn of listeners) fn();
}

export function readPins(): string[] {
  return load();
}

export function isPinned(id: string): boolean {
  return load().includes(id);
}

/** 切换置顶态；返回切换后的状态。 */
export function togglePin(id: string): boolean {
  const current = load();
  if (current.includes(id)) {
    persist(current.filter((pinned) => pinned !== id));
    return false;
  }
  persist([...current, id]);
  return true;
}

/** 会话删除/归档时同步摘除置顶，避免悬挂引用。 */
export function unpin(id: string): void {
  const current = load();
  if (current.includes(id)) persist(current.filter((pinned) => pinned !== id));
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getServerSnapshot(): string[] {
  return [];
}

/** 测试使用：清除模块级快照（localStorage 由测试自行清理）。 */
export function resetPinsForTests(): void {
  cached = null;
}

/** 置顶 id 列表（有序）+ 切换；任何变更通过 pub/sub 通知全部订阅者。 */
export function useSessionPins(): { pinnedIds: string[]; toggle: (id: string) => void } {
  const pinnedIds = useSyncExternalStore(subscribe, load, getServerSnapshot);
  const toggle = useCallback((id: string) => {
    togglePin(id);
  }, []);
  return { pinnedIds, toggle };
}
