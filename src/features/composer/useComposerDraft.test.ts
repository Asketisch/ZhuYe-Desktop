/**
 * useComposerDraft 单元测试 —— 草稿按会话持久化（F）。
 */
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftKeyFor, useComposerDraft } from './useComposerDraft';

describe('useComposerDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists text to the session-scoped key as it is typed', () => {
    const { result } = renderHook(() => useComposerDraft('sess-1'));

    act(() => result.current.setText('未发送的草稿'));

    expect(localStorage.getItem('reflect.draft.sess-1')).toBe('未发送的草稿');
    expect(result.current.text).toBe('未发送的草稿');
  });

  it('restores the draft when the same session remounts', () => {
    localStorage.setItem('reflect.draft.sess-2', '之前的内容');
    const { result } = renderHook(() => useComposerDraft('sess-2'));

    expect(result.current.text).toBe('之前的内容');
  });

  it('loads the other session draft when switching sessions', () => {
    localStorage.setItem('reflect.draft.sess-b', 'B 的草稿');
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useComposerDraft(id),
      { initialProps: { id: 'sess-a' as string | null } },
    );
    act(() => result.current.setText('A 的草稿'));

    rerender({ id: 'sess-b' });

    expect(result.current.text).toBe('B 的草稿');
    // A 的草稿仍在原 key 下,切回可恢复。
    expect(localStorage.getItem('reflect.draft.sess-a')).toBe('A 的草稿');

    rerender({ id: 'sess-a' });
    expect(result.current.text).toBe('A 的草稿');
  });

  it('clearDraft removes the persisted value', () => {
    const { result } = renderHook(() => useComposerDraft('sess-1'));
    act(() => result.current.setText('即将发送'));
    act(() => result.current.clearDraft());

    expect(localStorage.getItem('reflect.draft.sess-1')).toBeNull();
    expect(result.current.text).toBe('');
  });

  it('uses a shared key for the new-chat page (no session id)', () => {
    const { result } = renderHook(() => useComposerDraft(null));
    act(() => result.current.setText('新对话草稿'));

    expect(localStorage.getItem(draftKeyFor(null))).toBe('新对话草稿');
  });
  it('only clears the submitted session draft if its content has not changed', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useComposerDraft(id),
      { initialProps: { id: 'a' as string | null } });
    act(() => result.current.setText('original'));
    act(() => result.current.setText('new edit'));
    act(() => result.current.clearSubmittedDraft('original', 'a'));
    expect(result.current.text).toBe('new edit');
    rerender({ id: 'b' });
    act(() => result.current.setText('other session'));
    const clear = result.current.clearSubmittedDraft;
    unmount();
    clear('new edit', 'a');
    expect(localStorage.getItem(draftKeyFor('a'))).toBeNull();
    expect(localStorage.getItem(draftKeyFor('b'))).toBe('other session');
  });

});
