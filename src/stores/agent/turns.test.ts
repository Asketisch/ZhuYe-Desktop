/**
 * turns 单元测试 —— summarizeToolOutput（结构化 ToolOutput 归一化）+
 * 流式分段（upsertDelta / upsertThinking / finalizeAssistantText 只拼接
 * 末尾同类 item，保证文本与工具调用按时序交错）。
 */
import { describe, expect, it } from 'vitest';
import {
  abortTurnOrLatestStreaming,
  finalizeAssistantText,
  resetStreamingOutput,
  summarizeToolOutput,
  upsertDelta,
  upsertThinking,
} from './turns';
import type { Turn, TurnItem } from './types';

describe('summarizeToolOutput', () => {
  it('passes plain strings through', () => {
    expect(summarizeToolOutput('hello')).toEqual({ text: 'hello' });
  });

  it('returns empty text for null/undefined', () => {
    expect(summarizeToolOutput(null)).toEqual({ text: '' });
    expect(summarizeToolOutput(undefined)).toEqual({ text: '' });
  });

  it('extracts text, diff and path from a structured ToolOutput', () => {
    const output = {
      content: [
        { type: 'text', text: 'wrote 42 bytes' },
        { type: 'diff', unified_diff: '--- a/f.rs\n+++ b/f.rs\n@@ -1 +1 @@\n-a\n+b' },
      ],
      is_error: false,
      metadata: { path: 'src/f.rs' },
      elapsed_ms: 3,
    };
    expect(summarizeToolOutput(output)).toEqual({
      text: 'wrote 42 bytes',
      diff: '--- a/f.rs\n+++ b/f.rs\n@@ -1 +1 @@\n-a\n+b',
      path: 'src/f.rs',
    });
  });

  it('joins multiple text blocks and tolerates missing diff/metadata', () => {
    const output = {
      content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
      is_error: false,
    };
    expect(summarizeToolOutput(output)).toEqual({ text: 'line1\nline2' });
  });

  it('falls back to pretty JSON for unknown object shapes', () => {
    expect(summarizeToolOutput({ foo: 1 })).toEqual({ text: '{\n  "foo": 1\n}' });
  });
});

// ====== 流式分段：文本/思考只与末尾同类 item 拼接 ======

const toolCallItem: TurnItem = {
  kind: 'tool_call',
  toolName: 'bash',
  callId: 'c1',
  argsSummary: 'ls',
  status: 'done',
};

function turnWith(...items: TurnItem[]): Turn[] {
  return [{ id: 't1', items, status: 'streaming' }];
}

describe('upsertDelta segment interleaving', () => {
  it('appends deltas while assistant_text is the last item', () => {
    let turns = turnWith({ kind: 'assistant_text', text: 'Hello' });
    turns = upsertDelta(turns, 't1', ', world');
    expect(turns[0].items).toEqual([{ kind: 'assistant_text', text: 'Hello, world', streaming: true }]);
  });

  it('starts a new segment after a tool call instead of merging backwards', () => {
    // 一轮多次模型迭代：文本 → 工具调用 → 新文本。新文本必须另起
    // 气泡，工具调用保持在其真实时序位置（而非被挤到对话流底部）。
    let turns = turnWith({ kind: 'assistant_text', text: '先调研' }, toolCallItem);
    turns = upsertDelta(turns, 't1', '结论是…');
    expect(turns[0].items).toEqual([
      { kind: 'assistant_text', text: '先调研' },
      toolCallItem,
      { kind: 'assistant_text', text: '结论是…', streaming: true },
    ]);
  });

  it('creates the first segment on an empty turn', () => {
    const turns = upsertDelta(turnWith(), 't1', 'hi');
    expect(turns[0].items).toEqual([{ kind: 'assistant_text', text: 'hi', streaming: true }]);
  });
});

describe('upsertThinking segment interleaving', () => {
  it('appends to a trailing thinking item', () => {
    let turns = turnWith({ kind: 'thinking', text: 'a' });
    turns = upsertThinking(turns, 't1', 'b');
    // F50:upsertThinking 现在显式打 variant(默认 raw)。
    expect(turns[0].items).toEqual([{ kind: 'thinking', text: 'ab', variant: 'raw' }]);
  });

  it('starts a new thinking segment after other items', () => {
    const turns = upsertThinking(turnWith(toolCallItem), 't1', 'a');
    expect(turns[0].items).toEqual([
      toolCallItem,
      { kind: 'thinking', text: 'a', variant: 'raw' },
    ]);
  });
});

describe('finalizeAssistantText', () => {
  it('replaces a trailing assistant_text with the final text', () => {
    const turns = finalizeAssistantText(
      turnWith({ kind: 'assistant_text', text: 'partial', streaming: true }),
      't1',
      'final',
    );
    expect(turns[0].items).toEqual([{ kind: 'assistant_text', text: 'final', streaming: false }]);
  });

  it('appends when the turn does not end with assistant_text', () => {
    const turns = finalizeAssistantText(turnWith(toolCallItem), 't1', 'final');
    expect(turns[0].items).toEqual([
      toolCallItem,
      { kind: 'assistant_text', text: 'final', streaming: false },
    ]);
  });
});

// ── v1.10:agent_message_reset / 中断兜底 ────────────────────────────

describe('resetStreamingOutput', () => {
  it('drops trailing streaming text, thinking and running tool calls', () => {
    const doneCall: TurnItem = {
      kind: 'tool_call',
      toolName: 'bash',
      callId: 'c0',
      argsSummary: 'ls',
      status: 'done',
    };
    const runningCall: TurnItem = {
      kind: 'tool_call',
      toolName: 'write',
      callId: 'c1',
      argsSummary: '{"path"',
      status: 'running',
      argsStream: '{"path"',
    };
    const turns: Turn[] = [
      {
        id: 't1',
        status: 'streaming',
        items: [
          { kind: 'assistant_text', text: '先看目录' },
          doneCall,
          { kind: 'tool_output', callId: 'c0', text: 'a.rs', isError: false },
          { kind: 'thinking', text: '再写文件' },
          runningCall,
        ],
      },
    ];
    const next = resetStreamingOutput(turns, 't1');
    // 已完成步骤(文本 + 工具调用 + 输出)保留;半成品全部丢弃。
    expect(next[0].items).toEqual([
      { kind: 'assistant_text', text: '先看目录' },
      doneCall,
      { kind: 'tool_output', callId: 'c0', text: 'a.rs', isError: false },
    ]);
  });

  it('clears a trailing streaming text segment only', () => {
    const turns = turnWith({ kind: 'assistant_text', text: 'partial', streaming: true });
    expect(resetStreamingOutput(turns, 't1')[0].items).toEqual([]);
  });

  it('leaves unknown turns untouched (does not materialize a new one)', () => {
    const turns = turnWith({ kind: 'assistant_text', text: 'partial', streaming: true });
    expect(resetStreamingOutput(turns, 'other')).toBe(turns);
  });
});

describe('abortTurnOrLatestStreaming', () => {
  it('marks the matching turn aborted', () => {
    const turns = abortTurnOrLatestStreaming(turnWith(), 't1');
    expect(turns[0].status).toBe('aborted');
  });

  it('falls back to the last streaming turn when the id is unknown', () => {
    // 引擎空闲期中断回执的 turn_id 是现编的 —— 前端按 id 配不到时必须
    // 兜底解卡,否则表现为「停止按钮点了没反应」。
    const turns: Turn[] = [
      { id: 't1', items: [], status: 'done' },
      { id: 't2', items: [], status: 'streaming' },
    ];
    const next = abortTurnOrLatestStreaming(turns, 'unknown-id');
    expect(next.map((turn) => turn.status)).toEqual(['done', 'aborted']);
  });

  it('is a no-op when nothing is streaming', () => {
    const turns: Turn[] = [{ id: 't1', items: [], status: 'done' }];
    expect(abortTurnOrLatestStreaming(turns, 'unknown-id')).toBe(turns);
  });
});
