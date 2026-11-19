/**
 * Vitest — useAttachments hook(含 A3 状态机:browser_file pending → settle/error)。
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAttachments } from './useAttachments';

describe('useAttachments', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useAttachments());
    expect(result.current.attachments).toEqual([]);
  });

  it('addLocalImage appends', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.addLocalImage('/tmp/a.png'));
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].attachment).toEqual({ kind: 'local_image', path: '/tmp/a.png' });
  });

  it('addInlineImage appends with mime', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.addInlineImage('data:image/png;base64,abc', 'image/png'));
    expect(result.current.attachments[0].attachment).toEqual({
      kind: 'image',
      data: 'data:image/png;base64,abc',
      mime_type: 'image/png',
    });
  });

  it('addSkillMention appends skill', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.addSkillMention('code-review'));
    expect(result.current.attachments[0].attachment).toEqual({ kind: 'skill', name: 'code-review' });
  });

  it('addFileMention appends file mention (with and without range)', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => {
      result.current.addFileMention('README.md');
      result.current.addFileMention('src/main.ts', { start_line: 10, end_line: 20 });
    });
    expect(result.current.attachments.map((a) => a.attachment)).toEqual([
      { kind: 'file', path: 'README.md' },
      { kind: 'file', path: 'src/main.ts', range: { start_line: 10, end_line: 20 } },
    ]);
  });

  it('browser file starts pending, settles to ready file mention (A3)', () => {
    const { result } = renderHook(() => useAttachments());
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    let id = '';
    act(() => {
      id = result.current.addBrowserFile(file);
    });
    expect(result.current.attachments[0]).toMatchObject({ id, status: 'pending' });
    expect(result.current.hasBlocking()).toBe(true);
    act(() => {
      result.current.updateAttachment(id, { kind: 'file', path: '/ws/.zhuye/uploads/1_notes.txt' });
    });
    expect(result.current.attachments[0]).toMatchObject({ status: 'ready' });
    expect(result.current.hasBlocking()).toBe(false);
    // 成功 settle 后不再保留原始字节源。
    expect(result.current.attachments[0].attachment).toEqual({
      kind: 'file',
      path: '/ws/.zhuye/uploads/1_notes.txt',
    });
  });

  it('failed ingest can be marked error and retried keeps source', () => {
    const { result } = renderHook(() => useAttachments());
    const file = new File(['x'], 'a.bin');
    let id = '';
    act(() => {
      id = result.current.addBrowserFile(file);
    });
    act(() => {
      result.current.updateAttachment(
        id,
        { kind: 'browser_file', path: 'a.bin', source: file },
        'error',
      );
    });
    expect(result.current.attachments[0]).toMatchObject({ status: 'error' });
    expect(result.current.hasBlocking()).toBe(true);
  });

  it('remove(idx) drops entry', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => {
      result.current.addLocalImage('/a');
      result.current.addLocalImage('/b');
    });
    act(() => result.current.remove(0));
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].attachment).toMatchObject({ path: '/b' });
  });

  it('removeById drops the matching staged entry', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.addFileMention('a.md'));
    act(() => result.current.addFileMention('b.md'));
    const firstId = result.current.attachments[0].id;
    act(() => result.current.removeById(firstId));
    expect(result.current.attachments.map((a) => a.attachment)).toEqual([
      { kind: 'file', path: 'b.md' },
    ]);
  });

  it('clear empties all', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => {
      result.current.addLocalImage('/a');
      result.current.addSkillMention('foo');
    });
    act(() => result.current.clear());
    expect(result.current.attachments).toHaveLength(0);
  });

  it('clears only attachments included in the submitted snapshot', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.addLocalImage('/a'));
    const sent = result.current.attachments;
    act(() => result.current.addLocalImage('/b'));
    act(() => result.current.clearSent(sent));
    expect(result.current.attachments.map((a) => a.attachment)).toEqual([
      { kind: 'local_image', path: '/b' },
    ]);
  });

  it('toUserInputItems converts each kind', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => {
      result.current.addLocalImage('/x.png');
      result.current.addInlineImage('d', 'image/png');
      result.current.addSkillMention('s');
    });
    const items = result.current.toUserInputItems();
    expect(items).toEqual([
      { type: 'local_image', path: '/x.png' },
      { type: 'image', data: 'd', mime_type: 'image/png' },
      { type: 'skill', name: 's' },
    ]);
  });

  it('toUserInputItems maps file mentions (range optional on the wire)', () => {
    const { result } = renderHook(() => useAttachments());
    act(() => {
      result.current.addFileMention('README.md');
      result.current.addFileMention('src/main.ts', { start_line: 1, end_line: 5 });
    });
    expect(result.current.toUserInputItems()).toEqual([
      { type: 'file', path: 'README.md' },
      { type: 'file', path: 'src/main.ts', range: { start_line: 1, end_line: 5 } },
    ]);
  });

  it('toUserInputItems maps settled browser files to file items', () => {
    const { result } = renderHook(() => useAttachments());
    const file = new File(['hi'], 'c.txt');
    let id = '';
    act(() => {
      id = result.current.addBrowserFile(file);
      result.current.updateAttachment(id, { kind: 'file', path: '/ws/.zhuye/uploads/2_c.txt' });
    });
    expect(result.current.toUserInputItems()).toEqual([
      { type: 'file', path: '/ws/.zhuye/uploads/2_c.txt' },
    ]);
  });
});
