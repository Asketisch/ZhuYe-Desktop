import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const KEY_PREFIX = 'reflect.history.';
const CAP = 200;

function keyFor(workspace: string): string {
  return `${KEY_PREFIX}${workspace || 'default'}`;
}

function read(workspace: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(keyFor(workspace));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function write(workspace: string, list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(workspace), JSON.stringify(list));
  } catch {
    // 当存储空间不可用或已满时，历史记录采用尽力而为策略。
  }
}

export interface PromptHistoryApi {
  count: number;
  commit: (text: string) => void;
  recallPrev: (draft: string, setBuffer: (next: string) => void) => boolean;
  recallNext: (setBuffer: (next: string) => void) => boolean;
  isBrowsing: () => boolean;
  resetNavigation: () => void;
  clear: () => void;
}

export function usePromptHistory(workspace: string = 'default'): PromptHistoryApi {
  const [items, setItems] = useState<string[]>(() => read(workspace));
  const cursorRef = useRef<number | null>(null);
  const draftRef = useRef('');

  const resetNavigation = useCallback(() => {
    cursorRef.current = null;
    draftRef.current = '';
  }, []);

  useEffect(() => {
    setItems(read(workspace));
    resetNavigation();
  }, [workspace, resetNavigation]);

  const commit = useCallback(
    (text: string) => {
      const next = text.trim();
      if (!next) return;
      const current = read(workspace);
      if (current[current.length - 1] !== next) {
        current.push(next);
        if (current.length > CAP) current.splice(0, current.length - CAP);
        write(workspace, current);
        setItems(current.slice());
      }
      resetNavigation();
    },
    [workspace, resetNavigation],
  );

  const recallPrev = useCallback(
    (draft: string, setBuffer: (next: string) => void): boolean => {
      const current = read(workspace);
      if (current.length === 0) return false;
      if (cursorRef.current === null) draftRef.current = draft;
      const nextIndex = cursorRef.current === null
        ? current.length - 1
        : Math.max(0, cursorRef.current - 1);
      cursorRef.current = nextIndex;
      setBuffer(current[nextIndex]);
      return true;
    },
    [workspace],
  );

  const recallNext = useCallback(
    (setBuffer: (next: string) => void): boolean => {
      const current = read(workspace);
      if (cursorRef.current === null) return false;
      const nextIndex = cursorRef.current + 1;
      if (nextIndex >= current.length) {
        const draft = draftRef.current;
        resetNavigation();
        setBuffer(draft);
        return true;
      }
      cursorRef.current = nextIndex;
      setBuffer(current[nextIndex]);
      return true;
    },
    [workspace, resetNavigation],
  );

  const clear = useCallback(() => {
    write(workspace, []);
    setItems([]);
    resetNavigation();
  }, [workspace, resetNavigation]);

  return useMemo(
    () => ({
      count: items.length,
      commit,
      recallPrev,
      recallNext,
      isBrowsing: () => cursorRef.current !== null,
      resetNavigation,
      clear,
    }),
    [items.length, commit, recallPrev, recallNext, resetNavigation, clear],
  );
}
