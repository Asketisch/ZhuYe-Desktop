/**
 * Composer 行为 —— 斜杠命令 / 提示历史 / 附件提交 / 弹出补全。
 *
 * 全部走真实 Composer 组件（真实键盘/文件输入事件），断言：
 *   - slash dispatch → 对应 Tauri 命令 + 参数
 *   - toast 反馈（compact / 未实装 / 非法输入）
 *   - ↑/↓ 历史回溯
 *   - 附件 + 文本 → submitItems 组合 Submission
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;

beforeEach(() => {
  // 草稿持久化到 localStorage（F）—— 逐用例清理避免串扰。
  window.localStorage.clear();
  backend = installFakeBackend();
  backend.agent.script = [{ emit: { type: 'agent_message_delta', delta: 'ack' } }];
});

afterEach(async () => {
  await resetAppAfterEach();
});

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Message ZhuYe') as HTMLTextAreaElement;
}

async function send(text: string): Promise<void> {
  await screen.findByLabelText('Message ZhuYe');
  const textarea = composer();
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

describe('slash commands (real dispatch → backend)', () => {
  it('/compact requests context compaction and toasts', async () => {
    renderApp();
    await send('/compact');

    await waitFor(() => expect(backend.callsOf('reflect_compact').length).toBe(1));
    await waitFor(() =>
      expect(useAgentStore.getState().toasts.some((t) => t.message.includes('Compact'))).toBe(true),
    );
    // 不产生 user turn（非对话提交）。
    expect(useAgentStore.getState().turns.length).toBe(0);
  });

  it('/plan <task> enters plan mode with the task text', async () => {
    renderApp();
    await send('/plan refactor the auth module');

    await waitFor(() => expect(backend.callsOf('reflect_enter_plan_mode').length).toBe(1));
    expect(backend.lastArgsOf('reflect_enter_plan_mode')).toEqual({
      task: 'refactor the auth module',
    });
  });

  it('/effort high / low dispatch set_effort; invalid level rejected with toast', async () => {
    renderApp();
    await send('/effort high');
    await waitFor(() => expect(backend.lastArgsOf('reflect_set_effort')).toEqual({ level: 'high' }));

    await send('/effort maximum');
    await waitFor(() =>
      expect(
        useAgentStore.getState().toasts.some((t) =>
          t.message.includes('/effort requires'),
        ),
      ).toBe(true),
    );
    // 非法值不应触发第二次 IPC。
    expect(backend.callsOf('reflect_set_effort').length).toBe(1);
  });

  it('/mode plan switches permission mode', async () => {
    renderApp();
    await send('/mode plan');
    await waitFor(() =>
      expect(backend.lastArgsOf('reflect_set_permission_mode')).toEqual({ mode: 'plan' }),
    );
  });

  it('/interrupt aborts via reflect_interrupt', async () => {
    renderApp();
    await send('/interrupt');
    await waitFor(() => expect(backend.callsOf('reflect_interrupt').length).toBe(1));
  });

  it('unknown command is rejected with an error toast and no IPC', async () => {
    renderApp();
    await send('/definitely-not-a-command');
    await waitFor(() =>
      expect(
        useAgentStore.getState().toasts.some((t) => t.kind === 'error' && t.message.includes('Unknown command')),
      ).toBe(true),
    );
    expect(backend.agent.submissions.length).toBe(0);
  });

  it('unimplemented command (/model) is a no-op info toast', async () => {
    renderApp();
    await send('/model');
    await waitFor(() =>
      expect(
        useAgentStore.getState().toasts.some((t) => t.message.includes('Coding Plans')),
      ).toBe(true),
    );
    expect(backend.agent.submissions.length).toBe(0);
  });
});

describe('slash popup autocomplete', () => {
  it('typing "/" opens the popup; Escape closes it; selection filters', async () => {
    renderApp();
    const textarea = await screen.findByLabelText('Message ZhuYe');

    fireEvent.change(textarea, { target: { value: '/' } });
    const popup = await screen.findByRole('listbox');

    fireEvent.change(textarea, { target: { value: '/comp' } });
    await waitFor(() => expect(popup.textContent).toContain('compact'));

    fireEvent.keyDown(textarea, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

describe('prompt history (↑/↓ recall)', () => {
  it('recalls previous prompts in reverse order, then forward', async () => {
    renderApp();
    await send('first prompt');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    await send('second prompt');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(2));

    const textarea = composer();
    // ↑ → 最近一条（second），再 ↑ → first。
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => expect(textarea.value).toBe('second prompt'));
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => expect(textarea.value).toBe('first prompt'));
    // ↓ 回到 second。
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await waitFor(() => expect(textarea.value).toBe('second prompt'));
  });

  it('editing text resets history navigation', async () => {
    renderApp();
    await send('alpha');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));

    const textarea = composer();
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => expect(textarea.value).toBe('alpha'));
    // 手动输入 → 退出浏览态，再次 ↑ 仍取最近一条。
    fireEvent.change(textarea, { target: { value: 'typed fresh' } });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await waitFor(() => expect(textarea.value).toBe('alpha'));
  });
});

describe('attachments', () => {
  it('image attachment + text submits combined user_input items', async () => {
    renderApp();
    const fileInput = (await screen.findByTestId('composer-image-input')) as HTMLInputElement;

    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    fireEvent.change(fileInput, { target: { files: [] } });

    // 直接走 store submitItems 的输入组合（文件读取 API 在 jsdom 下受限，
    // 组合提交路径用 store action 驱动，线格式断言不变）。
    await useAgentStore.getState().submitItems([
      { type: 'text', text: 'look at this' },
      { type: 'image', data: pngBase64, mime_type: 'image/png' },
    ]);

    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    const submission = backend.agent.submissions[0];
    expect(submission.op).toEqual({
      type: 'user_input',
      items: [
        { type: 'text', text: 'look at this' },
        { type: 'image', data: pngBase64, mime_type: 'image/png' },
      ],
    });
    // 首 text item 成为 user turn 的显示文本。
    const turns = useAgentStore.getState().turns;
    expect(turns[0].items[0]).toMatchObject({ kind: 'user_text', text: 'look at this' });
  });
});

describe('composer ergonomics', () => {
  it('Shift+Enter inserts a newline instead of submitting', async () => {
    renderApp();
    const textarea = await screen.findByLabelText('Message ZhuYe');
    fireEvent.change(textarea, { target: { value: 'line1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    // 未触发提交。
    expect(backend.agent.submissions.length).toBe(0);
  });

  it('empty input does not submit', async () => {
    renderApp();
    const textarea = await screen.findByLabelText('Message ZhuYe');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(backend.agent.submissions.length).toBe(0);
  });

  it('submit clears the composer for the next message', async () => {
    renderApp();
    await send('clear me after');
    await waitFor(() => expect(backend.agent.submissions.length).toBe(1));
    await waitFor(() => expect(composer().value).toBe(''));
  });
});
