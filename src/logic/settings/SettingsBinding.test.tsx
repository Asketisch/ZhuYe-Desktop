import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsViewProps } from '@/contracts/settings/settings';
import { RendererProvider } from '@/logic/renderer/RendererProvider';
import { SettingsView } from '@/features/settings/SettingsView';
import { renderer } from '@/render';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

function AlternateSettings({ rawToml, onTomlChange, onSave }: SettingsViewProps) {
  return <section>
    <textarea aria-label="configuration" value={rawToml} onChange={(event) => onTomlChange(event.target.value)} />
    <button onClick={onSave}>save alternate</button>
  </section>;
}

describe('设置绑定', () => {
  it('应用可注入替代界面并通过原有控制器保存草稿', async () => {
    resetMockInvoke();
    const save = vi.fn(async (..._args: unknown[]) => undefined);
    mockInvoke('zhuye_get_config', async () => '[active]\nprovider = "openai"');
    mockInvoke('zhuye_save_config', save);
    render(<QueryClientProvider client={createTestQueryClient()}>
      <RendererProvider renderer={{ ...renderer, SettingsView: AlternateSettings }}><SettingsView /></RendererProvider>
    </QueryClientProvider>);
    const input = screen.getByLabelText('configuration');
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toContain('openai'));
    fireEvent.change(input, { target: { value: '[active]\nprovider = "anthropic"' } });
    fireEvent.click(screen.getByText('save alternate'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toEqual({ toml: '[active]\nprovider = "anthropic"' });
  });
});
