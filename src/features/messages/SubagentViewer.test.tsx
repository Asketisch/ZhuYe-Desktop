/**
 * SubagentViewer 测试 —— 子代理会话只读查看器的数据链路与交互。
 *
 * 走真实 IPC mock(mockInvoke 的 zhuye_replay_session):断言 replay 记录
 * → turns 渲染、关闭按钮回父会话、回放失败显示可读错误(经
 * commandErrorMsg 解包,不裸抛 [object Object])。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import { I18nProvider, saveLocale } from '@/utils/i18n';

import { SubagentViewer } from './SubagentViewer';

const T1 = '075f8a83-d84b-4f9d-93eb-9c428881bb43';
const SAMPLE_RECORDS = [
  {
    type: 'session_meta',
    session_id: 'child-1',
    model: 'anthropic/stub',
    started_at: '2026-08-13T03:01:00Z',
    parent_session_id: 'parent-9',
  },
  { type: 'message', turn_id: T1, role: 'user', content: [{ type: 'text', text: '探索一下目录' }] },
  { type: 'message', turn_id: T1, role: 'assistant', content: '结论：这是一个 React 项目' },
];

function renderViewer(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <I18nProvider>
        <SubagentViewer subId="child-1" title="代码探索者" onClose={onClose} />
      </I18nProvider>,
    ),
  };
}

describe('SubagentViewer (子代理会话只读查看器)', () => {
  beforeEach(() => {
    resetMockInvoke();
    saveLocale('en');
  });
  afterEach(() => cleanup());

  it('replay 记录构建 turns 并渲染横幅与正文', async () => {
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    renderViewer();
    // 横幅:子会话标题 + 只读徽标。
    expect(screen.getByTestId('subagent-session-viewer')).toBeTruthy();
    expect(screen.getByText('代码探索者')).toBeTruthy();
    // 正文:replay 出的用户与助手消息。
    await waitFor(() => {
      expect(screen.getByText('结论：这是一个 React 项目')).toBeTruthy();
    });
    expect(screen.getByText('探索一下目录')).toBeTruthy();
  });

  it('关闭按钮回调 onClose(返回父会话)', async () => {
    mockInvoke('zhuye_replay_session', async () => SAMPLE_RECORDS);
    const { onClose } = renderViewer();
    fireEvent.click(screen.getByTestId('subagent-viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('replay 失败显示解包后的可读错误', async () => {
    mockInvoke('zhuye_replay_session', async () => {
      throw { msg: 'session belongs to workspace .' };
    });
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText(/Replay failed: session belongs to workspace \./)).toBeTruthy();
    });
  });
});
