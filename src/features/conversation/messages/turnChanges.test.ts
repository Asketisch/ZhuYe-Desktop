/**
 * turnChanges —— 「本轮改动」派生纯函数测试。
 *
 * 覆盖：从 turn 的 items 派生文件改动清单（写类工具过滤 / path 兜底 /
 * 同轮同文件合并）、unified diff 行数统计、卡片头汇总。
 */
import { describe, it, expect } from 'vitest';
import {
  countDiffLines,
  deriveChangesFromTurn,
  summarizeTurnChanges,
} from '@/features/conversation/messages/turnChanges';
import type { Turn, TurnItem } from '@/stores/agent/types';

function turnWith(items: TurnItem[]): Turn {
  return { id: 'turn-1', status: 'done', items };
}

describe('deriveChangesFromTurn', () => {
  it('只收写类工具的输出，读类工具不计', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'bash', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: 'ok', isError: false, path: '/w/a.txt' },
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c2', status: 'done' },
      { kind: 'tool_output', callId: 'c2', text: '', isError: false, path: '/w/b.txt' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('/w/b.txt');
    expect(changes[0].toolName).toBe('edit');
  });

  it('metadata 缺 path 时回退到工具参数的 path', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{"path":"src/x.ts"}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('src/x.ts');
  });

  it('同轮同文件多次改动合并为一条，diff 按增量累计拼接', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: '/w/a.txt', diff: '+first' },
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c2', status: 'done' },
      { kind: 'tool_output', callId: 'c2', text: '', isError: false, path: '/w/a.txt', diff: '+second' },
    ]));
    expect(changes).toHaveLength(1);
    // 引擎每次 edit 只产出「本次替换」的调用级 diff —— last-wins 会让
    // 卡头永远停在最后一次的 +1 −1;累计拼接后统计全轮增删。
    expect(changes[0].diff).toBe('+first\n+second');
    expect(summarizeTurnChanges(changes)).toEqual({ files: 1, added: 2, removed: 0 });
  });

  it('同文件两次单行 edit:卡头 +2 −2,diff 含两个 hunk(审查可见全部增量)', () => {
    const hunk1 = ['@@ -161,7 +161,7 @@', ' context', '-old line', '+new line'].join('\n');
    const hunk2 = ['@@ -210,3 +210,3 @@', ' ctx', '-old2', '+new2'].join('\n');
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'e1', status: 'done' },
      { kind: 'tool_output', callId: 'e1', text: '', isError: false, path: '/w/a.css', diff: hunk1 },
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'e2', status: 'done' },
      { kind: 'tool_output', callId: 'e2', text: '', isError: false, path: '/w/a.css', diff: hunk2 },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].diff).toBe(`${hunk1}\n${hunk2}`);
    expect(summarizeTurnChanges(changes)).toEqual({ files: 1, added: 2, removed: 2 });
    // 多段 unified diff 的 @@ 头不计增删(既有 countDiffLines 口径)。
    expect(countDiffLines(changes[0].diff).added).toBe(2);
  });

  it('空 diff 的后续改动(delete_file)不覆盖已累计的 diff', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: '/w/a.txt', diff: '+kept' },
      { kind: 'tool_call', toolName: 'delete_file', argsSummary: '{}', callId: 'c2', status: 'done' },
      { kind: 'tool_output', callId: 'c2', text: 'deleted', isError: false, path: '/w/a.txt' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].diff).toBe('+kept');
    expect(changes[0].toolName).toBe('delete_file');
  });

  it('ast 工具(rename/replace 产出 unified_diff)计入改动卡', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'ast', argsSummary: '{"action":"rename"}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: '/w/a.rs', diff: '-fn old() {}\n+fn new() {}' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].toolName).toBe('ast');
    expect(summarizeTurnChanges(changes)).toEqual({ files: 1, added: 1, removed: 1 });
  });

  it('失败标记不丢（成功 + 失败同文件合并后仍标失败）', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: true, path: '/w/a.txt' },
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c2', status: 'done' },
      { kind: 'tool_output', callId: 'c2', text: '', isError: false, path: '/w/a.txt' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].isError).toBe(true);
  });

  it('孤儿输出（无配对 tool_call）不计', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_output', callId: 'ghost', text: '', isError: false, path: '/w/a.txt' },
    ]));
    expect(changes).toHaveLength(0);
  });

  // 后端写类工具注册名逐字对齐（zhuye-tools Tool::name(),大小写敏感）——
  // 白名单漏收时整类改动不进卡（历史 bug:只有 edit 能进卡）。
  it('write 新建文件计入改动卡（metadata.path）', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'write', argsSummary: '{"path":"src/new.ts"}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: 'src/new.ts', diff: '+hello' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('src/new.ts');
    expect(changes[0].toolName).toBe('write');
  });

  it('delete_file 无 diff 也计入（行数 0/0）', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'delete_file', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: 'deleted /w/old.txt', isError: false, path: '/w/old.txt' },
    ]));
    expect(changes).toHaveLength(1);
    expect(changes[0].toolName).toBe('delete_file');
    expect(changes[0].diff).toBe('');
    expect(countDiffLines(changes[0].diff)).toEqual({ added: 0, removed: 0 });
  });

  it('PlanWrite（PascalCase）与 notebook_edit（args path 兜底）计入', () => {
    const changes = deriveChangesFromTurn(turnWith([
      { kind: 'tool_call', toolName: 'PlanWrite', argsSummary: '{"path":"plans/p.md"}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '', isError: false, path: 'plans/p.md', diff: '+plan' },
      { kind: 'tool_call', toolName: 'notebook_edit', argsSummary: '{"action":"overwrite","path":"n.ipynb"}', callId: 'c2', status: 'done' },
      { kind: 'tool_output', callId: 'c2', text: '', isError: false },
    ]));
    expect(changes).toHaveLength(2);
    expect(changes[0].toolName).toBe('PlanWrite');
    expect(changes[1].toolName).toBe('notebook_edit');
    expect(changes[1].path).toBe('n.ipynb');
  });
});

describe('countDiffLines', () => {
  it('排除 +++ / --- 文件头，只数真实增删', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      ' context',
      '-old',
      '+new',
      '+new2',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ added: 2, removed: 1 });
  });

  it('空 diff → 0/0', () => {
    expect(countDiffLines('')).toEqual({ added: 0, removed: 0 });
  });
});

describe('summarizeTurnChanges', () => {
  it('汇总文件数与增删行数', () => {
    const changes = [
      { path: '/a', diff: '+x\n-y', isError: false, toolName: 'edit' },
      { path: '/b', diff: '+p\n+q\n-r', isError: false, toolName: 'write' },
    ];
    expect(summarizeTurnChanges(changes)).toEqual({ files: 2, added: 3, removed: 2 });
  });
});
