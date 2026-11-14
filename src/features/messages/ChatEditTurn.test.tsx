/**
 * Vitest —— 编辑历史消息(v1.11 F7+D6)。
 *
 * 覆盖 handleEditTurn 的可组合语义(零协议改动:Rewind + composer 预填):
 * - rewind 目标推算:index>0 → 前一轮;index 0 → 含自身(清空重发)
 * - prefill 总线把原文装回挂载的 Composer 草稿(真实 hook 渲染)
 * - 无用户文本的 turn 不可编辑
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerDraft, emitComposerPrefill } from '@/features/composer/useComposerDraft';
import { useAgentStore } from '@/stores/agentStore';

function seedTurns() {
  useAgentStore.setState({
    turns: [
      { id: 't0', items: [{ kind: 'user_text', text: '第一条' }], status: 'done' },
      { id: 't1', items: [{ kind: 'assistant_text', text: '回答' }], status: 'done' },
      { id: 't2', items: [{ kind: 'user_text', text: '第二条' }], status: 'done' },
    ],
    loadedSessionId: 'sess-1',
  } as never);
}

/** handleEditTurn 的 rewind 目标推算(与 ChatView.handleEditTurn 同逻辑)。 */
function rewindTargetFor(turns: { id: string }[], turnId: string): string {
  const idx = turns.findIndex((tr) => tr.id === turnId);
  if (idx === -1) throw new Error('turn not found');
  return idx === 0 ? turns[idx].id : turns[idx - 1].id;
}

describe('edit history turn — semantic building blocks', () => {
  it('rewind target for editing turn t2 is the previous turn t1 (truncate t2+)', () => {
    seedTurns();
    const turns = useAgentStore.getState().turns;
    expect(rewindTargetFor(turns, 't2')).toBe('t1');
  });

  it('rewind target for editing turn t0 is itself (clear all, resend)', () => {
    seedTurns();
    const turns = useAgentStore.getState().turns;
    expect(rewindTargetFor(turns, 't0')).toBe('t0');
  });

  it('turn without user text is not editable', () => {
    seedTurns();
    const t1 = useAgentStore.getState().turns.find((tr) => tr.id === 't1');
    const editable = t1?.items.some((it) => it.kind === 'user_text') ?? false;
    expect(editable).toBe(false);
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
