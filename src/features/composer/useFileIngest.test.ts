/**
 * Vitest — useFileIngest(A1:浏览器字节流文件 → 落盘 → file mention)。
 *
 * 状态机:pending 入列 → reflect_ingest_upload 成功 settle 为真实路径
 * file mention;失败标 error + toast;retry 重跑原始 File。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAttachments } from './useAttachments';
import { useFileIngest } from './useFileIngest';
import { useAgentStore } from '@/stores/agentStore';

// 直改 store 的 toast 收集(不入快照断言,只验证调用次数)。
const toastSpy = vi.spyOn(useAgentStore.getState(), 'pushToast');

function makeFile(name: string, content = 'hello'): File {
  return new File([content], name, { type: 'text/plain' });
}

// FileReader 在 happy-dom 可用;invoke 走 fakeBackend(见 tests/helpers)。
// 这里直接 mock '@/../utils/commands/files' 模块,聚焦状态机本身。
const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/commands/files', () => ({
  reflect_ingest_upload: (...args: unknown[]) => uploadMock(...(args as [string, string])),
}));

function renderIngest() {
  return renderHook(() => {
    const attachments = useAttachments();
    const ingest = useFileIngest(attachments);
    return { attachments, ingest };
  });
}

describe('useFileIngest', () => {
  beforeEach(() => {
    uploadMock.mockReset();
    toastSpy.mockClear();
  });

  it('ingestFiles:pending → settle 为工作区真实路径 file mention', async () => {
    uploadMock.mockResolvedValue({ path: '/ws/.zhuye/uploads/1_a.txt', size: 5 });
    const { result } = renderIngest();
    act(() => result.current.ingest.ingestFiles([makeFile('a.txt')]));
    // 入列即 pending。
    expect(result.current.attachments.attachments[0].status).toBe('pending');
    await waitFor(() =>
      expect(result.current.attachments.attachments[0].status).toBe('ready'),
    );
    expect(result.current.attachments.attachments[0].attachment).toEqual({
      kind: 'file',
      path: '/ws/.zhuye/uploads/1_a.txt',
    });
    expect(uploadMock).toHaveBeenCalledWith('a.txt', expect.any(String));
  });

  it('失败标 error + toast,retry 复用原始 File 重跑', async () => {
    uploadMock.mockRejectedValueOnce(new Error('disk full'));
    uploadMock.mockResolvedValue({ path: '/ws/.zhuye/uploads/2_b.txt', size: 5 });
    const { result } = renderIngest();
    act(() => result.current.ingest.ingestFiles([makeFile('b.txt')]));
    await waitFor(() =>
      expect(result.current.attachments.attachments[0].status).toBe('error'),
    );
    expect(toastSpy).toHaveBeenCalledTimes(1);
    act(() => result.current.ingest.retry(result.current.attachments.attachments[0].id));
    await waitFor(() =>
      expect(result.current.attachments.attachments[0].status).toBe('ready'),
    );
    expect(result.current.attachments.attachments[0].attachment).toEqual({
      kind: 'file',
      path: '/ws/.zhuye/uploads/2_b.txt',
    });
  });

  it('超过 64 MiB 的文件直接标错,不发起上传', async () => {
    const { result } = renderIngest();
    const huge = makeFile('huge.bin');
    // File.size 是原型 getter,用 defineProperty 覆盖为超限值。
    Object.defineProperty(huge, 'size', { value: 64 * 1024 * 1024 + 1 });
    act(() => result.current.ingest.ingestFiles([huge]));
    await waitFor(() =>
      expect(result.current.attachments.attachments[0].status).toBe('error'),
    );
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
