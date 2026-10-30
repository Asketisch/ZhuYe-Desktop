/**
 * CodeMirrorEditor 冒烟测试 —— CM6 视图创建、内容渲染、hunk 装饰与
 * Accept/Reject 事件链路(jsdom + ResizeObserver stub)。
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { parseUnifiedDiff } from '../editor/diffHunks';

const DIFF = [
  '@@ -1,2 +1,2 @@',
  '-old line',
  '+new line',
  ' keep',
  '',
].join('\n');

const VALUE = ['new line', 'keep', ''].join('\n');

function renderEditor(overrides?: {
  onRejectHunk?: (i: number, c: string) => Promise<string | null>;
}) {
  const onAcceptHunk = vi.fn();
  const onRejectHunk =
    overrides?.onRejectHunk ?? vi.fn(async () => 'restored');
  const { container } = render(
    <CodeMirrorEditor
      path="a.py"
      value={VALUE}
      revision={0}
      hunks={parseUnifiedDiff(DIFF)}
      onAcceptHunk={onAcceptHunk}
      onRejectHunk={onRejectHunk}
    />,
  );
  return { container, onAcceptHunk, onRejectHunk };
}

describe('CodeMirrorEditor', () => {
  it('渲染 CM 视图并显示文档内容', () => {
    const { container } = renderEditor();
    expect(screen.getByTestId('cm-editor')).toBeTruthy();
    expect(container.querySelector('.cm-content')?.textContent).toContain('new line');
  });

  it('routes the platform save shortcut to the save handler', () => {
    const onSave = vi.fn();
    const { container } = render(<CodeMirrorEditor path="a.py" value={VALUE} revision={0}
      hunks={[]} onAcceptHunk={() => {}} onRejectHunk={async () => null} onSave={onSave} />);
    const content = container.querySelector('.cm-content')!;
    fireEvent.keyDown(content, { key: 's', ctrlKey: true });
    fireEvent.keyDown(content, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('hunk widget 渲染删除行与 Accept/Reject 控件', () => {
    const { container } = renderEditor();
    const widget = container.querySelector('.cm-hunkWidget');
    expect(widget).toBeTruthy();
    expect(widget?.textContent).toContain('old line');
    const buttons = Array.from(widget?.querySelectorAll('button') ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(['Accept', 'Reject']);
  });

  it('只高亮同一 hunk 中的新增行', async () => {
    const diff = '@@ -1,3 +1,3 @@\n-old1\n+new1\n keep\n-old2\n+new2\n';
    const { container } = render(<CodeMirrorEditor path="a.py" value={'new1\nkeep\nnew2\n'} revision={0}
      hunks={parseUnifiedDiff(diff)} onAcceptHunk={() => {}} onRejectHunk={async () => null} />);
    await vi.waitFor(() => {
      const marked = Array.from(container.querySelectorAll('.cm-addedLine')).map((el) => el.textContent);
      expect(marked).toHaveLength(2);
      expect(marked[0]).toContain('new1');
      expect(marked[1]).toBe('new2');
      expect(marked.join('')).not.toContain('keep');
    });
  });

  it('Accept 按钮冒泡到 onAcceptHunk', () => {
    const { container, onAcceptHunk } = renderEditor();
    const accept = Array.from(container.querySelectorAll('.cm-hunkBar button')).find(
      (b) => b.textContent === 'Accept',
    ) as HTMLButtonElement;
    fireEvent.click(accept);
    expect(onAcceptHunk).toHaveBeenCalledWith(0);
  });

  it('Reject 按钮带当前缓冲内容调用 onRejectHunk,返回新内容后刷新缓冲', async () => {
    const { container, onRejectHunk } = renderEditor();
    const reject = Array.from(container.querySelectorAll('.cm-hunkBar button')).find(
      (b) => b.textContent === 'Reject',
    ) as HTMLButtonElement;
    fireEvent.click(reject);
    await vi.waitFor(() => {
      expect(onRejectHunk).toHaveBeenCalledWith(0, VALUE);
    });
    // onRejectHunk 返回 'restored' → 缓冲被整体替换。
    await vi.waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('restored');
    });
  });
  it('切换文件后不会把旧文件异步恢复结果写入新缓冲', async () => {
    let finish!: (value: string | null) => void;
    const onReject = () => new Promise<string | null>((resolve) => { finish = resolve; });
    const props = { revision: 0, hunks: parseUnifiedDiff(DIFF), onAcceptHunk: () => {}, onRejectHunk: onReject };
    const { container, rerender } = render(<CodeMirrorEditor path="a.py" value={VALUE} {...props} />);
    fireEvent.click(Array.from(container.querySelectorAll('.cm-hunkBar button')).find((b) => b.textContent === 'Reject')!);
    rerender(<CodeMirrorEditor path="b.py" value="other file" {...props} />);
    await act(async () => { finish('restored old file'); await Promise.resolve(); });
    expect(container.querySelector('.cm-content')?.textContent).toContain('other file');
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('restored old file');
  });

});
