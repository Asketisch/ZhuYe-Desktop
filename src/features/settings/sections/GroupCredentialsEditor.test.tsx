/**
 * Vitest — 组内凭据编辑器（[[model_group.credentials]]）。
 *
 * 覆盖:新增 / 改字段(label·key·base_url·model·weight·配额) / 删除 /
 * label 必填提示。组件是纯受控的 —— 只回调 onChange,落盘由 GroupForm 负责。
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { GroupCredentialsEditor } from './GroupCredentialsEditor';
import type { GroupCredentialEntry } from '../config/groups';

function credential(over: Partial<GroupCredentialEntry> = {}): GroupCredentialEntry {
  return { label: 'backup', apiKey: 'sk-backup', baseUrl: '', model: 'm1', weight: 1, quota: null, ...over };
}

/** 状态化包装 —— 组件是纯受控的，DOM 需要跟随 onChange 回写才能连续操作。 */
function renderEditor(credentials: GroupCredentialEntry[] = []) {
  const onChange = vi.fn();
  function Wrapper() {
    const [current, setCurrent] = useState(credentials);
    return (
      <GroupCredentialsEditor
        credentials={current}
        onChange={(next) => {
          onChange(next);
          setCurrent(next);
        }}
      />
    );
  }
  render(
    <I18nProvider>
      <Wrapper />
    </I18nProvider>,
  );
  return { onChange };
}

describe('GroupCredentialsEditor', () => {
  it('空列表给出提示,新增一条空凭据', () => {
    const { onChange } = renderEditor([]);
    expect(screen.getByText(/No credentials yet/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('group-credential-add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([
      { label: '', apiKey: '', baseUrl: '', model: '', weight: 1, quota: null },
    ]);
  });

  it('渲染既有凭据的字段值', () => {
    renderEditor([credential({ quota: { windowSecs: 18000, maxTokens: 100000 } })]);
    const row = screen.getByTestId('group-credential-0');
    expect((within(row).getByLabelText('Credential label') as HTMLInputElement).value).toBe('backup');
    expect((within(row).getByLabelText('API key') as HTMLInputElement).value).toBe('sk-backup');
    expect((within(row).getByLabelText('Weight') as HTMLInputElement).value).toBe('1');
    expect((within(row).getByLabelText('Quota window (secs)') as HTMLInputElement).value).toBe('18000');
    expect((within(row).getByLabelText('Quota max tokens') as HTMLInputElement).value).toBe('100000');
  });

  it('改 label / 权重 / 配额 → onChange 带新值', () => {
    const { onChange } = renderEditor([credential()]);
    const row = screen.getByTestId('group-credential-0');
    fireEvent.change(within(row).getByLabelText('Credential label'), { target: { value: 'renamed' } });
    expect(onChange.mock.calls.at(-1)![0][0].label).toBe('renamed');
    fireEvent.change(within(row).getByLabelText('Weight'), { target: { value: '4' } });
    expect(onChange.mock.calls.at(-1)![0][0].weight).toBe(4);
    fireEvent.change(within(row).getByLabelText('Quota window (secs)'), { target: { value: '3600' } });
    expect(onChange.mock.calls.at(-1)![0][0].quota).toEqual({ windowSecs: 3600, maxTokens: 0 });
  });

  it('配额两侧都清空 → quota 置 null', () => {
    const { onChange } = renderEditor([credential({ quota: { windowSecs: 10, maxTokens: 20 } })]);
    const row = screen.getByTestId('group-credential-0');
    fireEvent.change(within(row).getByLabelText('Quota window (secs)'), { target: { value: '' } });
    fireEvent.change(within(row).getByLabelText('Quota max tokens'), { target: { value: '' } });
    expect(onChange.mock.calls.at(-1)![0][0].quota).toBeNull();
  });

  it('label 为空 → 给出必填提示', () => {
    renderEditor([credential({ label: '' })]);
    expect(screen.getByText(/Credential label is required/)).toBeTruthy();
  });

  it('删除凭据 → onChange 移除该条', () => {
    const { onChange } = renderEditor([credential({ label: 'a' }), credential({ label: 'b' })]);
    fireEvent.click(screen.getByTestId('group-credential-delete-0'));
    expect(onChange.mock.calls.at(-1)![0]).toHaveLength(1);
    expect(onChange.mock.calls.at(-1)![0][0].label).toBe('b');
  });
});
