/**
 * Vitest —— 编辑历史消息(v1.11 F7+D6)。
 *
 * 直接锁定 ChatView 导出的**真实实现** `editRewindTargetFor`(防测试内
 * 复刻逻辑漂移)+ prefill 总线把原文装回挂载的 Composer 草稿(真实 hook 渲染):
 * - rewind 目标推算:恒为目标轮自身(引擎 truncate_after 丢弃该轮含之后,
 *   此前的轮次完整保留)
 * - 同时返回该轮用户原文(供 prefill)
 * - 无用户文本的 turn / 不存在的 turn → null(不可编辑)
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerDraft, emitComposerPrefill } from '@/logic/input/composer/useComposerDraft';
import { editRewindTargetFor } from '@/features/conversation/messages/ChatView';

const TURNS = [
  { id: 't0', items: [{ kind: 'user_text', text: '第一条' }] },
  { id: 't1', items: [{ kind: 'assistant_text', text: '回答' }] },
  { id: 't2', items: [{ kind: 'user_text', text: '第二条' }] },
];

describe('edit history turn — semantic building blocks (real implementation)', () => {
  it('editing t2 rewinds to t2 itself (engine drops target turn and after)', () => {
    const target = editRewindTargetFor(TURNS, 't2');
    expect(target).toEqual({ rewindTo: 't2', userText: '第二条' });
  });

  it('editing t0 rewinds to itself (clear all, resend) with its own text', () => {
    const target = editRewindTargetFor(TURNS, 't0');
    expect(target).toEqual({ rewindTo: 't0', userText: '第一条' });
  });

  it('turn without user text is not editable (assistant turn → null)', () => {
    expect(editRewindTargetFor(TURNS, 't1')).toBeNull();
  });

  it('unknown turn id is not editable (null, no throw)', () => {
    expect(editRewindTargetFor(TURNS, 'no-such-turn')).toBeNull();
  });

  it('prefill bus rewrites the mounted composer draft with the original text', () => {
    const { result } = renderHook(() => useComposerDraft('sess-1'));
    // 初始草稿为空 → emit 原文 → 草稿变为原文(编辑流的「装回输入框」)。
    act(() => {
      emitComposerPrefill('第一条(编辑后)');
    });
    expect(result.current.text).toBe('第一条(编辑后)');
  });
});
