import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ChatViewProps } from '@/contracts/conversation/chat';
import type { ComposerViewProps } from '@/contracts/conversation/composer';
import type { ShellViewProps } from '@/contracts/harness/shell';
import type { SettingsViewProps } from '@/contracts/settings/settings';
import { renderer } from '@/render';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';

function AlternateComposer(props: ComposerViewProps) {
  return <div>
    <textarea aria-label="alternate message" ref={props.textareaRef} value={props.text} onChange={props.onChange} onKeyDown={props.onKeyDown} />
    <button onClick={props.onSend} disabled={!props.canSend}>alternate send</button>
  </div>;
}

function AlternateChat({ turns, slots: { Composer } }: ChatViewProps) {
  return <article>
    <div data-testid="alternate-messages">{turns.flatMap((turn) => turn.items.map((item) =>
      item.kind === 'user_text' || item.kind === 'assistant_text' ? item.text : '',
    )).join(' ')}</div>
    <Composer />
  </article>;
}

function AlternateShell({ sidebar, content, slots, suppressInteraction }: ShellViewProps) {
  const { ModalStack, ConfirmDialogHost } = slots;
  return <div>
    <nav>{sidebar.groups.flatMap((group) => group.sessions.map((session) =>
      <button key={session.session_id} onClick={() => sidebar.onSelect(session.session_id)}>{session.title ?? session.session_id}</button>,
    ))}</nav>
    <main>{content}</main>
    <ModalStack suppressInteractionModals={suppressInteraction} />
    <ConfirmDialogHost />
  </div>;
}

function AlternateSettings({ rawToml, onTomlChange, onSave }: SettingsViewProps) {
  return <div>
    <textarea aria-label="alternate configuration" value={rawToml} onChange={(event) => onTomlChange(event.target.value)} />
    <button onClick={onSave}>alternate save</button>
  </div>;
}

let backend: FakeBackend;
beforeEach(() => { backend = installFakeBackend(); });
afterEach(async () => { await resetAppAfterEach(); });

describe('替代渲染入口', () => {
  it('通过同一应用装配发送并接收流式消息', async () => {
    backend.agent.script = [
      { emit: { type: 'agent_message_delta', delta: 'alternate reply' } },
      { emit: { type: 'turn_complete', turn_id: 't-1', usage: {}, status: 'success' } },
    ];
    const app = renderApp({ ...renderer, AppShell: AlternateShell, ChatView: AlternateChat, Composer: AlternateComposer });
    await app.navigate('/chat');
    const input = await screen.findByLabelText('alternate message');
    fireEvent.change(input, { target: { value: 'alternate question' } });
    fireEvent.click(screen.getByText('alternate send'));
    await waitFor(() => expect(backend.agent.submissions).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('alternate-messages').textContent).toContain('alternate reply'));
    expect(screen.getByTestId('alternate-messages').textContent).toContain('alternate question');
  });
  it('替代主壳能切换会话，替代设置页能保存配置', async () => {
    const app = renderApp({ ...renderer, AppShell: AlternateShell, ChatView: AlternateChat,
      Composer: AlternateComposer, SettingsView: AlternateSettings });
    fireEvent.click(await screen.findByText('Fix login bug'));
    await waitFor(() => expect(app.pathname()).toBe('/chat/sess-alpha'));
    await waitFor(() => expect(screen.getByTestId('alternate-messages').textContent).toContain('Summarize the auth flow'));
    await app.navigate('/settings');
    const input = await screen.findByLabelText('alternate configuration');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).not.toBe(''));
    fireEvent.change(input, { target: { value: '[active]\nprovider = "anthropic"' } });
    fireEvent.click(screen.getByText('alternate save'));
    await waitFor(() => expect(backend.calls.some((call) => call.cmd === 'zhuye_save_config')).toBe(true));
  });

});
