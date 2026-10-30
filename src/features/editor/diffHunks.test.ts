/**
 * diffHunks 单元测试 —— unified diff 解析 + inverse-patch(内容锚定)。
 */
import { describe, expect, it } from 'vitest';
import {
  applyInverseAll,
  applyInverseHunk,
  locateHunk,
  parseUnifiedDiff,
} from './diffHunks';

const DIFF = `--- a/calc.py
+++ b/calc.py
@@ -1,4 +1,6 @@
 def find_multiple(n: int, k: int) -> int:
-    if n % k == 0:
-        return n
-    return n + k - (n % k)
+    if value % multiple == 0:
+        return value
+    return value + multiple - (value % multiple)
+
+# done
`;

describe('parseUnifiedDiff', () => {
  it('解析 hunk 的删除行 / 新增行 / 上下文', () => {
    const hunks = parseUnifiedDiff(DIFF);
    expect(hunks).toHaveLength(1);
    const h = hunks[0];
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    expect(h.removed).toEqual([
      '    if n % k == 0:',
      '        return n',
      '    return n + k - (n % k)',
    ]);
    expect(h.added).toEqual([
      '    if value % multiple == 0:',
      '        return value',
      '    return value + multiple - (value % multiple)',
      '',
      '# done',
    ]);
    expect(h.contextBefore).toEqual([' def find_multiple(n: int, k: int) -> int:'.slice(1)]);
  });

  it('空 diff / 无 hunk 文本返回空数组', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('hello world')).toEqual([]);
  });
});

const ORIGINAL = `def find_multiple(n: int, k: int) -> int:
    if n % k == 0:
        return n
    return n + k - (n % k)
`;

const EDITED = `def find_multiple(n: int, k: int) -> int:
    if value % multiple == 0:
        return value
    return value + multiple - (value % multiple)

# done
`;

describe('applyInverseHunk / applyInverseAll', () => {
  it('拒绝:按内容锚定把 hunk 还原为原文(无视行号漂移)', () => {
    const hunk = parseUnifiedDiff(DIFF)[0];
    const restored = applyInverseHunk(EDITED, hunk);
    expect(restored).toBe(ORIGINAL);
  });

  it('行号漂移时仍可锚定(前文插入了新行)', () => {
    const hunk = parseUnifiedDiff(DIFF)[0];
    const drifted = `# header comment\n\n${EDITED}`;
    expect(applyInverseHunk(drifted, hunk)).toBe(`# header comment\n\n${ORIGINAL}`);
  });

  it('锚点歧义(多处匹配)返回 null,不落盘半恢复状态', () => {
    const hunk = parseUnifiedDiff(DIFF)[0];
    const ambiguous = `${EDITED}${EDITED}`;
    expect(applyInverseHunk(ambiguous, hunk)).toBeNull();
  });

  it('纯删除 hunk 没有上下文时拒绝猜测插入位置', () => {
    const diff = `@@ -2,2 +1,0 @@
-    b
-    c
`;
    const hunk = parseUnifiedDiff(diff)[0];
    const content = 'a\n    d\n';
    expect(applyInverseHunk(content, hunk)).toBeNull();
  });

  it('纯删除 hunk 优先内容锚定(更早 hunk 已拒绝、行号漂移时不错位)', () => {
    // 原文件 a,b,c,d,e;edit1 删 b(带上下文 a/c)。先拒绝更晚的 hunk
    // (e 恢复)后,oldStart 相对当前内容已漂移 —— 必须靠 contextAfter(c)
    // 锚定,插回正确位置而非行号。
    const edit1 = `@@ -1,3 +1,2 @@
 a
-b
 c
`;
    const hunk1 = parseUnifiedDiff(edit1)[0];
    expect(hunk1.contextAfter).toEqual(['c']);
    expect(applyInverseHunk('a\nc\nd\ne\n', hunk1)).toBe('a\nb\nc\nd\ne\n');
  });

  it('多文件 diff 的 ---/+++ 文件头不吞进 hunk', () => {
    const multi = `@@ -1,1 +1,1 @@
-a
+AA
--- a/y.txt
+++ b/y.txt
@@ -1,1 +1,1 @@
-c
+CC
`;
    const hunks = parseUnifiedDiff(multi);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].added).toEqual(['AA']);
    expect(hunks[0].removed).toEqual(['a']);
    expect(hunks[1].added).toEqual(['CC']);
    expect(hunks[1].removed).toEqual(['c']);
  });

  it('保持同一 hunk 中多个修改之间的上下文顺序', () => {
    const diff = `@@ -1,5 +1,5 @@
 a
-b
+B
 c
-d
+D
 e
`;
    const hunk = parseUnifiedDiff(diff)[0];
    expect(applyInverseHunk('a\nB\nc\nD\ne\n', hunk)).toBe('a\nb\nc\nd\ne\n');
  });

  it('恢复原文件的末尾换行状态', () => {
    const missingOld = '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n';
    const missingNew = '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n';
    expect(applyInverseHunk('new\n', parseUnifiedDiff(missingOld)[0])).toBe('old');
    expect(applyInverseHunk('new', parseUnifiedDiff(missingNew)[0])).toBe('old\n');
  });

  it('拒绝不完整的 hunk', () => {
    expect(parseUnifiedDiff('@@ -1,2 +1,2 @@\n-a\n+b\n')).toEqual([]);
  });

  it('applyInverseAll:多 hunk 全部还原', () => {
    const diff = `@@ -1,2 +1,2 @@
-a
+AA
 b
@@ -3,1 +3,1 @@
-c
+CC
`;
    const hunks = parseUnifiedDiff(diff);
    const restored = applyInverseAll('AA\nb\nCC\n', hunks);
    expect(restored).toBe('a\nb\nc\n');
  });
});

describe('locateHunk', () => {
  it('返回新增行区间(0 基,含 context 校验)', () => {
    const hunk = parseUnifiedDiff(DIFF)[0];
    const located = locateHunk(EDITED, hunk);
    expect(located).toEqual({ addedStart: 1, addedEnd: 6 });
  });
});
