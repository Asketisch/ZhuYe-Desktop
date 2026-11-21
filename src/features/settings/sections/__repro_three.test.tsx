/** 复现:连续添加三个模型组,第三个是否落盘。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { zhuye_list_provider_models } from '@/utils/commands';
import { zhuye_credential_pool_status } from '@/utils/commands/runtimeStatus';
import { GroupsSection } from './GroupsSection';
import { createTestQueryClient } from '@/test/setup';

vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return { ...actual, zhuye_list_provider_models: vi.fn() };
});
vi.mock('@/utils/commands/runtimeStatus', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/runtimeStatus')>('@/utils/commands/runtimeStatus');
  return { ...actual, zhuye_credential_pool_status: vi.fn() };
});

const BASE = `[active]
group = "demo"

[[model_group]]
id = "demo"
endpoint = "openai"
model = "m0"
`;

function Harness() {
  const [toml, setToml] = useState(BASE);
  return (
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <GroupsSection rawToml={toml} onChange={setToml} onCommit={setToml} />
      </QueryClientProvider>
    </I18nProvider>
  );
}
import { useState } from 'react';

async function addGroup(id: string) {
  fireEvent.click(screen.getByTestId('groups-add'));
  fireEvent.change(screen.getByLabelText('Group ID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: `https://${id}.test` } });
  fireEvent.click(screen.getByText('Save group'));
  await waitFor(() => screen.getByTestId(`group-edit-${id}`), { timeout: 3000 });
}

describe('repro: 连续添加三个模型组', () => {
  beforeEach(() => {
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'openai',
      models: [{ id: 'm1', display_name: '', supports_vision: null, is_free: null, context_window: null, max_output_tokens: null, supports_reasoning: null }],
    });
    vi.mocked(zhuye_credential_pool_status).mockResolvedValue([]);
    localStorage.clear();
  });

  it('三个组全部落盘', async () => {
    render(<Harness />);
    await addGroup('group-a');
    await addGroup('group-b');
    await addGroup('group-c');
    const nav = screen.getByTestId('groups-nav');
    expect(nav.textContent).toContain('group-a');
    expect(nav.textContent).toContain('group-b');
    expect(nav.textContent).toContain('group-c');
  });
});
