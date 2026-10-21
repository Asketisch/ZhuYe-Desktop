/**
 * turnsFromRollout 单元测试 —— 直接以真实 rollout JSONL 线格式
 * (reflect_protocol::RolloutRecord tagged union) 作为输入。
 */
import { describe, expect, it } from 'vitest';
import { turnsFromRollout } from './replay';
import type { ReflectRolloutRecord } from '@/utils/types';

const T1 = '075f8a83-d84b-4f9d-93eb-9c428881bb43';
const T2 = '1af25630-0000-0000-0000-000000000000';

function rec(partial: Record<string, unknown>): ReflectRolloutRecord {
  return partial as ReflectRolloutRecord;
}

const BASE_RECORDS: ReflectRolloutRecord[] = [
  rec({ type: 'session_meta', session_id: 'sess-1', model: 'anthropic/x', started_at: '2026-08-13T03:01:00Z' }),
  rec({ type: 'permission_mode_changed', from: 'auto', to: 'plan', at: '2026-08-13T03:01:00Z' }),
  rec({
    type: 'message',
    turn_id: T1,
    role: 'user',
    content: [{ type: 'text', text: '帮我写一个 plan 模板' }],
  }),
  rec({
    type: 'message',
    turn_id: T1,
    role: 'assistant',
    content: '## Plan 模板\n- 背景\n- 目标',
  }),
  rec({ type: 'token_count', turn_id: T1, usage: { input_tokens: 100, total_tokens: 120 }, at: '2026-08-13T03:01:30Z' }),
];

describe('turnsFromRollout', () => {
  it('groups user + assistant messages by turn_id', () => {
    const { turns } = turnsFromRollout(BASE_RECORDS);
    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn.id).toBe(T1);
    expect(turn.status).toBe('done');
    expect(turn.items).toEqual([
      { kind: 'user_text', text: '帮我写一个 plan 模板' },
      { kind: 'assistant_text', text: '## Plan 模板\n- 背景\n- 目标' },
    ]);
  });

  it('skips non-message records (session_meta / token_count / permission_mode_changed)', () => {
    const { turns } = turnsFromRollout(BASE_RECORDS);
    for (const turn of turns) {
      for (const item of turn.items) {
        expect(['user_text', 'assistant_text']).toContain(item.kind);
      }
    }
  });

  it('handles plain-string content and block-array content in the same turn', () => {
    const { turns } = turnsFromRollout([
      rec({ type: 'message', turn_id: T1, role: 'user', content: '纯字符串消息' }),
      rec({ type: 'message', turn_id: T1, role: 'assistant', content: [{ type: 'text', text: '块数组回复' }] }),
    ]);
    expect(turns[0].items).toEqual([
      { kind: 'user_text', text: '纯字符串消息' },
      { kind: 'assistant_text', text: '块数组回复' },
    ]);
  });

  it('orders turns by first appearance (chronological)', () => {
    const { turns } = turnsFromRollout([
      rec({ type: 'message', turn_id: T1, role: 'user', content: 'first' }),
      rec({ type: 'message', turn_id: T2, role: 'user', content: 'second' }),
      rec({ type: 'message', turn_id: T1, role: 'assistant', content: 'first reply' }),
      rec({ type: 'message', turn_id: T2, role: 'assistant', content: 'second reply' }),
    ]);
    expect(turns.map((t) => t.id)).toEqual([T1, T2]);
    expect(turns[0].items.map((i) => (i.kind === 'assistant_text' ? i.text : null))).toContain('first reply');
    expect(turns[1].items).toHaveLength(2);
  });

  it('renders tool_use / tool_result blocks as tool_call / tool_output', () => {
    const { turns } = turnsFromRollout([
      rec({ type: 'message', turn_id: T1, role: 'user', content: '读一下文件' }),
      rec({
        type: 'message',
        turn_id: T1,
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-1', name: 'Read', args: { path: '/tmp/a.txt' } },
          {
            type: 'tool_result',
            call_id: 'call-1',
            output: { content: [{ type: 'text', text: 'file body' }], is_error: false },
          },
          { type: 'text', text: '文件内容如上。' },
        ],
      }),
    ]);
    expect(turns[0].items).toEqual([
      { kind: 'user_text', text: '读一下文件' },
      { kind: 'tool_call', toolName: 'Read', argsSummary: '{"path":"/tmp/a.txt"}', callId: 'call-1', status: 'done' },
      { kind: 'tool_output', callId: 'call-1', text: 'file body', isError: false },
      { kind: 'assistant_text', text: '文件内容如上。' },
    ]);
  });

  it('marks tool_output as error when output.is_error is true', () => {
    const { turns } = turnsFromRollout([
      rec({
        type: 'message',
        turn_id: T1,
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-9', name: 'Bash', args: {} },
          {
            type: 'tool_result',
            call_id: 'call-9',
            output: { content: [{ type: 'text', text: 'command failed' }], is_error: true },
          },
        ],
      }),
    ]);
    const output = turns[0].items.find((i) => i.kind === 'tool_output');
    expect(output).toEqual({ kind: 'tool_output', callId: 'call-9', text: 'command failed', isError: true });
  });

  it('extracts unified diff + path from tool_result content blocks', () => {
    const { turns } = turnsFromRollout([
      rec({
        type: 'message',
        turn_id: T1,
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call-2', name: 'edit', args: {} },
          {
            type: 'tool_result',
            call_id: 'call-2',
            output: {
              content: [
                { type: 'text', text: 'updated src/main.rs' },
                {
                  type: 'diff',
                  unified_diff: '--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1,2 +1,2 @@\n-old\n+new',
                },
              ],
              is_error: false,
              metadata: { path: 'src/main.rs' },
            },
          },
        ],
      }),
    ]);
    expect(turns[0].items[1]).toEqual({
      kind: 'tool_output',
      callId: 'call-2',
      text: 'updated src/main.rs',
      diff: '--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1,2 +1,2 @@\n-old\n+new',
      path: 'src/main.rs',
      isError: false,
    });
  });

  it('keeps diff-only tool_result even when there is no text block', () => {
    const { turns } = turnsFromRollout([
      rec({
        type: 'message',
        turn_id: T1,
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            call_id: 'call-3',
            output: {
              content: [{ type: 'diff', unified_diff: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b' }],
              is_error: false,
            },
          },
        ],
      }),
    ]);
    expect(turns[0].items).toEqual([
      {
        kind: 'tool_output',
        callId: 'call-3',
        text: '',
        diff: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b',
        isError: false,
      },
    ]);
  });

  it('compaction records 不进对话流,聚合到 compactions 统计', () => {
    const { turns, compactions } = turnsFromRollout([
      rec({ type: 'message', turn_id: T1, role: 'user', content: 'x' }),
      rec({
        type: 'compaction',
        turn_id: T1,
        strategy: 'microcompact',
        removed_count: 12,
        summary: '<summary>很长的合成摘要…</summary>',
      }),
      rec({
        type: 'compaction',
        turn_id: T2,
        strategy: 'smart_prune',
        removed_count: 3,
        summary: '',
      }),
    ]);
    // 历史 compaction record 不再生成 turn item。
    expect(turns[0].items).toEqual([{ kind: 'user_text', text: 'x' }]);
    // record 无 token 数,tokensSaved 不含历史。
    expect(compactions).toEqual({
      count: 2,
      removedMessages: 15,
      tokensSaved: 0,
      last: 'smart_prune: 3 msgs',
      records: [],
    });
  });

  it('ignores records without a turn_id or with unparseable content', () => {
    const { turns } = turnsFromRollout([
      rec({ type: 'message', role: 'user', content: 'no turn id' }),
      rec({ type: 'message', turn_id: T1, role: 'user', content: 42 }),
      rec({ type: 'message', turn_id: T1, role: 'system', content: 'system note' }),
      rec({ type: 'message', turn_id: T1, role: 'user', content: '' }),
      { bogus: true } as unknown as ReflectRolloutRecord,
    ]);
    // 无 turn_id / 非字符串 content / system role / 空文本 → 全部丢弃。
    expect(turns).toHaveLength(0);
  });

  it('returns empty turns and zeroed stats for an empty record stream', () => {
    expect(turnsFromRollout([])).toEqual({
      turns: [],
      compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] },
    });
  });
});
