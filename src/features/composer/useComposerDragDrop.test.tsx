/**
 * useComposerDragDrop —— 原生拖拽路径分流测试。
 *
 * ingestPaths:图片路径 → zhuye_read_image_base64 → inline image 附件;
 * 其余路径 → file mention;读取失败 → error toast。非 Tauri(jsdom)下
 * 原生订阅降级为 null,nativeDrop 恒 false(DOM 兜底保持可用)。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { useAttachments } from './useAttachments';
import { useComposerDragDrop, isImagePath } from './useComposerDragDrop';

function wrap({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}

describe('isImagePath', () => {
  it('accepts image extensions case-insensitively', () => {
    expect(isImagePath('/tmp/a.PNG')).toBe(true);
    expect(isImagePath('/tmp/b.jpeg')).toBe(true);
    expect(isImagePath('/tmp/c.WebP')).toBe(true);
  });

  it('rejects non-image paths', () => {
    expect(isImagePath('/tmp/notes.txt')).toBe(false);
    expect(isImagePath('/tmp/noext')).toBe(false);
    expect(isImagePath('/tmp/archive.tar.gz')).toBe(false);
  });
});

describe('useComposerDragDrop', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });

  it('routes image paths to inline attachments and others to file mentions', async () => {
    mockInvoke('zhuye_read_image_base64', async (_cmd: string, args?: { path: string }) => ({
      path: args?.path ?? '',
      mime_type: 'image/png',
      base64: 'AAAA',
      size: 3,
    }));
    const { result } = renderHook(
      () => {
        const attachments = useAttachments();
        const drop = useComposerDragDrop(attachments);
        return { attachments, drop };
      },
      { wrapper: wrap },
    );
    await act(() => result.current.drop.ingestPaths(['/tmp/shot.png', '/tmp/notes.txt']));
    await waitFor(() => expect(result.current.attachments.attachments).toHaveLength(2));
    // A3:staged 形状({id, status, attachment}),断言取 .attachment。
    const [img, mention] = result.current.attachments.attachments;
    expect(img.status).toBe('ready');
    // 原生拖拽持真实路径 → file 通道来源(发送时展开为出处标记)。
    expect(img.attachment).toEqual({
      kind: 'image',
      data: 'data:image/png;base64,AAAA',
      mime_type: 'image/png',
      source: { channel: 'file', path: '/tmp/shot.png' },
    });
    expect(mention.attachment).toEqual({ kind: 'file', path: '/tmp/notes.txt' });
  });

  it('pushes an error toast when image read fails', async () => {
    mockInvoke('zhuye_read_image_base64', async () => {
      throw new Error('not a supported image file');
    });
    const { result } = renderHook(
      () => {
        const attachments = useAttachments();
        const drop = useComposerDragDrop(attachments);
        return { attachments, drop };
      },
      { wrapper: wrap },
    );
    await act(() => result.current.drop.ingestPaths(['/tmp/broken.png']));
    await waitFor(() => expect(useAgentStore.getState().toasts.length).toBe(1));
    expect(useAgentStore.getState().toasts[0].kind).toBe('error');
    expect(useAgentStore.getState().toasts[0].message).toContain('not a supported image file');
    // 失败的图片不能产生半截附件。
    expect(result.current.attachments.attachments).toHaveLength(0);
  });

  it('keeps nativeDrop false outside Tauri (DOM fallback stays active)', async () => {
    const { result } = renderHook(() => useComposerDragDrop(useAttachments()), {
      wrapper: wrap,
    });
    await waitFor(() => expect(result.current.nativeDrop).toBe(false));
    expect(result.current.dragActive).toBe(false);
  });
});
