import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePromptHistory } from './usePromptHistory';

describe('usePromptHistory', () => {
  beforeEach(() => window.localStorage.clear());

  it('commits prompts, trims input, and skips consecutive duplicates', () => {
    const { result } = renderHook(() => usePromptHistory('ws1'));
    act(() => result.current.commit(' hello '));
    act(() => result.current.commit('hello'));
    act(() => result.current.commit('world'));
    expect(result.current.count).toBe(2);
  });

  it('walks backward and forward through history', () => {
    const { result } = renderHook(() => usePromptHistory('ws1'));
    act(() => result.current.commit('one'));
    act(() => result.current.commit('two'));

    let buffer = 'draft';
    act(() => result.current.recallPrev(buffer, (next) => { buffer = next; }));
    expect(buffer).toBe('two');
    act(() => result.current.recallPrev(buffer, (next) => { buffer = next; }));
    expect(buffer).toBe('one');
    act(() => result.current.recallNext((next) => { buffer = next; }));
    expect(buffer).toBe('two');
  });

  it('owns and restores the pre-browse draft at the end of history', () => {
    const { result } = renderHook(() => usePromptHistory('ws1'));
    act(() => result.current.commit('saved prompt'));

    let buffer = 'unfinished draft';
    act(() => result.current.recallPrev(buffer, (next) => { buffer = next; }));
    expect(buffer).toBe('saved prompt');
    expect(result.current.isBrowsing()).toBe(true);

    act(() => result.current.recallNext((next) => { buffer = next; }));
    expect(buffer).toBe('unfinished draft');
    expect(result.current.isBrowsing()).toBe(false);
  });

  it('clear empties the list and browsing state', () => {
    const { result } = renderHook(() => usePromptHistory('ws1'));
    act(() => result.current.commit('x'));
    act(() => result.current.recallPrev('draft', () => {}));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.isBrowsing()).toBe(false);
  });
});
