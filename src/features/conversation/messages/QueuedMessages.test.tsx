/**
 * QueuedMessages 组件测试 —— 待发送气泡的渲染与操作
 * （编辑 / 立即发送 / 移除）。
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { QueuedMessages } from './QueuedMessages';

function renderQueued() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <QueuedMessages />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe('QueuedMessages', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.getState().reset();
  });
  afterEach(cleanup);

  it('renders nothing when the queue is empty', () => {
    renderQueued();
    expect(screen.queryByTestId('queued-messages')).toBeNull();
  });

  it('renders queued messages with an index', () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '第一条' }]);
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '第二条' }]);
    renderQueued();

    expect(screen.getByText('第一条')).toBeDefined();
    expect(screen.getByText('第二条')).toBeDefined();
    expect(screen.getByTestId('queued-item-0')).toBeDefined();
    expect(screen.getByTestId('queued-item-1')).toBeDefined();
  });

  it('removes a queued message', () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '会话消息' }]);
    renderQueued();

    fireEvent.click(screen.getByTestId('queued-remove-0'));

    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
  });

  it('edits a queued message text', () => {
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '旧文本' }]);
    renderQueued();

    fireEvent.click(screen.getByTestId('queued-edit-0'));
    const input = screen.getByRole('textbox', { name: /edit/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '新文本' } });
    fireEvent.click(screen.getByTestId('queued-save'));

    expect(useAgentStore.getState().queuedMessages[0].text).toBe('新文本');
  });

  it('v1.13:每行带拖拽柄，附件名显示在正文下方', () => {
    useAgentStore.getState().enqueueMessage([
      { type: 'text', text: '看图' },
      { type: 'local_image', path: '/tmp/shot.png' },
    ]);
    renderQueued();
    const row = screen.getByTestId('queued-item-0');
    expect(row.querySelector('[title]')?.getAttribute('title')).toBeTruthy();
    expect(row.textContent).toContain('shot.png');
  });

  it('v1.13:拖拽到另一行 → 队列顺序按拖放位置重排', () => {
    const store = useAgentStore.getState();
    store.enqueueMessage([{ type: 'text', text: 'A' }]);
    store.enqueueMessage([{ type: 'text', text: 'B' }]);
    store.enqueueMessage([{ type: 'text', text: 'C' }]);
    renderQueued();

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {} };
    const rowA = screen.getByTestId('queued-item-0');
    const rowC = screen.getByTestId('queued-item-2');

    fireEvent.dragStart(rowA, { dataTransfer });
    fireEvent.dragOver(rowC, { dataTransfer });
    fireEvent.drop(rowC, { dataTransfer });

    expect(useAgentStore.getState().queuedMessages.map((m) => m.text)).toEqual(['B', 'C', 'A']);
  });

  it('send-now submits the message immediately and clears it from the queue', async () => {
    const submitted: unknown[] = [];
    mockInvoke('zhuye_submit', async (_cmd, args) => {
      submitted.push((args as { submission: unknown }).submission);
      return 'sub-ok';
    });
    useAgentStore.getState().enqueueMessage([{ type: 'text', text: '立刻走' }], '/abs/ws');
    renderQueued();

    fireEvent.click(screen.getByTestId('queued-send-0'));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(useAgentStore.getState().queuedMessages).toHaveLength(0);
  });
});
