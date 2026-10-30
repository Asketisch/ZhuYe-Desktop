/**
 * FilesView —— LSP 开关 / 预热链路测试。
 *
 * 覆盖:chip 默认关闭、点击开启调 reflect_lsp_set_enabled(true) 并持久化
 * 偏好、开启状态下打开代码文件触发 reflect_lsp_warmup。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, renderWithQueryClient } from '@/test/setup';
import { FilesView, lspPrefKey } from './FilesView';
import { useEditorStore } from '@/stores/editorStore';
import { useAgentStore } from '@/stores/agentStore';
import { EditorView } from '@codemirror/view';

const WORKSPACE = '/tmp/demo-ws';

function renderView() {
  return renderWithQueryClient(
    <I18nProvider>
      <FilesView />
    </I18nProvider>,
  );
}

describe('FilesView LSP', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState({ drafts: {} });
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'openai/x',
      workspace: WORKSPACE,
      degraded_reason: null,
    }));
    mockInvoke('reflect_list_dir', async () => ({
      cwd: WORKSPACE,
      entries: [
        { name: 'a.ts', path: `${WORKSPACE}/a.ts`, kind: 'file', size: 10, mtime: 0, depth: 0 },
      ],
    }));
    mockInvoke('reflect_read_file', async () => ({
      path: `${WORKSPACE}/a.ts`,
      content: 'const x = 1;\n',
      size: 13,
      binary: false,
      truncated: false,
    }));
  });

  it('chip 默认关闭;点击开启 → set_enabled(true) + 偏好持久化', async () => {
    const setCalls: boolean[] = [];
    let enabled = false;
    mockInvoke('reflect_lsp_status', async () => ({ enabled, servers: [] }));
    mockInvoke('reflect_lsp_set_enabled', async (_cmd: string, args?: { enabled: boolean }) => {
      enabled = args?.enabled ?? false;
      setCalls.push(enabled);
      return { enabled, servers: enabled ? ['rust-analyzer'] : [] };
    });
    mockInvoke('reflect_lsp_warmup', async () => ({ warmed: true, server: null }));
    renderView();

    const chip = await screen.findByTestId('files-lsp-toggle');
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    expect(chip.textContent).toContain('LSP off');
    fireEvent.click(chip);
    await waitFor(() => {
      expect(setCalls).toEqual([true]);
      expect(localStorage.getItem(lspPrefKey(WORKSPACE))).toBe('on');
    });
    await waitFor(() => expect(chip.textContent).toContain('LSP on'));
  });

  it('切换失败保留实际状态和原偏好，并允许重试', async () => {
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    let attempts = 0;
    mockInvoke('reflect_lsp_set_enabled', async () => {
      if (++attempts === 1) throw new Error('LSP failed');
      return { enabled: true, servers: [] };
    });
    renderView();
    const chip = await screen.findByTestId('files-lsp-toggle') as HTMLButtonElement;
    await waitFor(() => expect(chip.disabled).toBe(false));
    fireEvent.click(chip);
    expect((await screen.findByRole('alert')).textContent).toContain('LSP failed');
    expect(chip.textContent).toContain('LSP off');
    expect(localStorage.getItem(lspPrefKey(WORKSPACE))).toBeNull();
    await waitFor(() => expect(chip.disabled).toBe(false));
    fireEvent.click(chip);
    await waitFor(() => expect(chip.textContent).toContain('LSP on'));
    expect(localStorage.getItem(lspPrefKey(WORKSPACE))).toBe('on');
  });

  it('状态初始化未完成前不能切换 LSP', async () => {
    let finish!: (status: { enabled: boolean; servers: string[] }) => void;
    mockInvoke('reflect_lsp_status', () => new Promise((resolve) => { finish = resolve; }));
    const set = vi.fn(async () => ({ enabled: true, servers: [] }));
    mockInvoke('reflect_lsp_set_enabled', set);
    renderView();
    const chip = await screen.findByTestId('files-lsp-toggle') as HTMLButtonElement;
    await waitFor(() => expect(finish).toBeDefined());
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(set).not.toHaveBeenCalled();
    finish({ enabled: false, servers: [] });
    await waitFor(() => expect(chip.disabled).toBe(false));
  });

  it('工作区切换时等待旧操作完成，再恢复新工作区偏好', async () => {
    const other = '/tmp/other-ws';
    localStorage.setItem(lspPrefKey(WORKSPACE), 'on');
    localStorage.setItem(lspPrefKey(other), 'off');
    let enabled = false;
    let finish!: () => void;
    const calls: boolean[] = [];
    mockInvoke('reflect_lsp_status', async () => ({ enabled, servers: [] }));
    mockInvoke('reflect_lsp_set_enabled', async (_cmd: string, args?: { enabled: boolean }) => {
      const target = args?.enabled ?? false;
      calls.push(target);
      if (target) await new Promise<void>((resolve) => { finish = resolve; });
      enabled = target;
      return { enabled, servers: [] };
    });
    const client = createTestQueryClient();
    render(<QueryClientProvider client={client}><I18nProvider><FilesView /></I18nProvider></QueryClientProvider>);
    await waitFor(() => expect(calls).toEqual([true]));
    act(() => client.setQueryData(['agent-status'], { workspace: other }));
    await waitFor(() => expect(screen.getByTestId('files-workspace-path').textContent).toBe(other));
    await act(async () => { finish(); await Promise.resolve(); });
    await waitFor(() => expect(calls).toEqual([true, false]));
    await waitFor(() => expect((screen.getByTestId('files-lsp-toggle') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('files-lsp-toggle').textContent).toContain('LSP off');
  });

  it('开启状态下打开代码文件 → 触发 warmup', async () => {
    const warmupCalls: string[] = [];
    mockInvoke('reflect_lsp_status', async () => ({ enabled: true, servers: ['rust-analyzer'] }));
    mockInvoke('reflect_lsp_set_enabled', async () => ({ enabled: true, servers: [] }));
    mockInvoke('reflect_lsp_warmup', async (_cmd: string, args?: { path: string }) => {
      warmupCalls.push(args?.path ?? '');
      return { warmed: true, server: 'rust-analyzer' };
    });
    localStorage.setItem(lspPrefKey(WORKSPACE), 'on');
    renderView();

    const fileBtn = await screen.findByText('a.ts');
    fireEvent.click(fileBtn);
    await waitFor(() => expect(screen.getByTestId('cm-editor')).toBeTruthy());
    await waitFor(() => expect(warmupCalls).toEqual([`${WORKSPACE}/a.ts`]));
  });

  it('关闭状态下打开文件不触发 warmup', async () => {
    const warmup = vi.fn(async () => ({ warmed: false, server: null }));
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    mockInvoke('reflect_lsp_set_enabled', async () => ({ enabled: false, servers: [] }));
    mockInvoke('reflect_lsp_warmup', warmup);
    renderView();

    const fileBtn = await screen.findByText('a.ts');
    fireEvent.click(fileBtn);
    await waitFor(() => expect(screen.getByTestId('cm-editor')).toBeTruthy());
    // 给 effect 一拍执行窗口。
    await waitFor(() => expect(screen.getByTestId('files-lsp-toggle')).toBeTruthy());
    expect(warmup).not.toHaveBeenCalled();
  });
  it('截断文件只读且不提供写回变更的操作', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_read_file', async () => ({ path, content: 'AA\nb\n', size: 2000000, binary: false, truncated: true }));
    useEditorStore.getState().recordEdit(path, '@@ -1,2 +1,2 @@\n-a\n+AA\n b\n');
    renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    expect(await screen.findByText(/This file is too large/)).toBeTruthy();
    expect(screen.queryByTestId('files-reject-all')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.getByRole('textbox').getAttribute('contenteditable')).toBe('false');
    expect(useEditorStore.getState().pending[path]).toBeDefined();
    useEditorStore.getState().clear(path);
  });

  it('拒绝变更写盘期间冻结当前编辑器，完成后恢复编辑', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_read_file', async () => ({ path, content: 'AA\nb\n', size: 5, binary: false, truncated: false }));
    let finish!: (path: string) => void;
    mockInvoke('reflect_write_file', () => new Promise<string>((resolve) => { finish = resolve; }));
    useEditorStore.getState().recordEdit(path, '@@ -1,2 +1,2 @@\n-a\n+AA\n b\n');
    renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    fireEvent.click(await screen.findByTestId('files-reject-all'));
    await waitFor(() => expect(screen.getByRole('textbox').getAttribute('contenteditable')).toBe('false'));
    expect(screen.queryByTestId('files-reject-all')).toBeNull();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(path);
    await waitFor(() => expect(screen.getByRole('textbox').getAttribute('contenteditable')).toBe('true'));
  });

  it('saves the captured buffer while preserving edits made during the save', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    let finish!: (path: string) => void;
    const writes: string[] = [];
    mockInvoke('reflect_write_file', (_cmd, args) => {
      writes.push((args as { content: string }).content);
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    const { container, unmount } = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    await screen.findByTestId('cm-editor');
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'first' } }));
    fireEvent.click(screen.getByTestId('files-save'));
    await waitFor(() => expect(writes).toEqual(['first']));
    unmount();
    const reopened = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    await screen.findByTestId('cm-editor');
    expect((screen.getByTestId('files-save') as HTMLButtonElement).disabled).toBe(true);
    const reopenedView = EditorView.findFromDOM(reopened.container.querySelector('.cm-editor')!)!;
    act(() => reopenedView.dispatch({ changes: { from: 0, to: reopenedView.state.doc.length, insert: 'second' } }));
    await act(async () => { finish(path); await Promise.resolve(); });
    await waitFor(() => expect(useEditorStore.getState().drafts[path]).toEqual({ text: 'second', base: 'first' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await waitFor(() => expect(reopened.container.querySelector('.cm-content')?.textContent).toContain('second'));
    useEditorStore.getState().clearDraft(path);
  });

  it('keeps a draft when the file changed on disk before saving', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    let reads = 0;
    mockInvoke('reflect_read_file', async () => ({
      path, content: ++reads === 1 ? 'const x = 1;\n' : 'external change',
      size: 13, binary: false, truncated: false,
    }));
    const write = vi.fn();
    mockInvoke('reflect_write_file', write);
    const { container } = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    await screen.findByTestId('cm-editor');
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'draft' } }));
    fireEvent.click(screen.getByTestId('files-save'));
    expect((await screen.findByRole('alert')).textContent).toContain('file changed on disk');
    expect(write).not.toHaveBeenCalled();
    expect(useEditorStore.getState().drafts[path]?.text).toBe('draft');
    fireEvent.click(screen.getByTestId('files-discard'));
    await waitFor(() => expect(view.state.doc.toString()).toBe('external change'));
    expect(useEditorStore.getState().drafts[path]).toBeUndefined();
  });

  it('reports a failed save after leaving the view and retains the draft', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    let fail!: (error: Error) => void;
    mockInvoke('reflect_write_file', () => new Promise<string>((_, reject) => { fail = reject; }));
    useAgentStore.getState().reset();
    const { container, unmount } = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    await screen.findByTestId('cm-editor');
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'draft' } }));
    fireEvent.click(screen.getByTestId('files-save'));
    await waitFor(() => expect(fail).toBeTypeOf('function'));
    unmount();
    await act(async () => { fail(new Error('disk full')); await Promise.resolve(); });
    await waitFor(() => expect(useAgentStore.getState().toasts.some((toast) => toast.message.includes('disk full'))).toBe(true));
    expect(useEditorStore.getState().drafts[path]?.text).toBe('draft');
    useEditorStore.getState().clearDraft(path);
  });

  it('preserves new edits after reopening while a rejection is writing', async () => {
    const path = `${WORKSPACE}/a.ts`;
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    mockInvoke('reflect_read_file', async () => ({ path, content: 'AA\nb\n', size: 5, binary: false, truncated: false }));
    let finish!: (path: string) => void;
    mockInvoke('reflect_write_file', () => new Promise<string>((resolve) => { finish = resolve; }));
    useEditorStore.getState().recordEdit(path, '@@ -1,2 +1,2 @@\n-a\n+AA\n b\n');
    const first = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    fireEvent.click(await screen.findByTestId('files-reject-all'));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    first.unmount();
    const reopened = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    await screen.findByTestId('cm-editor');
    const view = EditorView.findFromDOM(reopened.container.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'new edit' } }));
    await act(async () => { finish(path); await Promise.resolve(); });
    await waitFor(() => expect(useEditorStore.getState().drafts[path]).toEqual({ text: 'new edit', base: 'a\nb\n' }));
    expect(view.state.doc.toString()).toBe('new edit');
    useEditorStore.getState().clearDraft(path);
    useEditorStore.getState().clear(path);
  });

  it('does not reject over a file changed on disk and can reload it', async () => {
    const path = `${WORKSPACE}/a.ts`;
    let reads = 0;
    mockInvoke('reflect_lsp_status', async () => ({ enabled: false, servers: [] }));
    mockInvoke('reflect_read_file', async () => ({
      path, content: ++reads === 1 ? 'AA\nb\n' : 'external edit\n', size: 5, binary: false, truncated: false,
    }));
    const write = vi.fn();
    mockInvoke('reflect_write_file', write);
    useEditorStore.getState().recordEdit(path, '@@ -1,2 +1,2 @@\n-a\n+AA\n b\n');
    const { container } = renderView();
    fireEvent.click(await screen.findByText('a.ts'));
    fireEvent.click(await screen.findByTestId('files-reject-all'));
    expect((await screen.findByRole('alert')).textContent).toContain('file changed on disk');
    expect(write).not.toHaveBeenCalled();
    expect(useEditorStore.getState().pending[path]).toBeDefined();
    fireEvent.click(screen.getByTestId('files-discard'));
    await waitFor(() => expect(container.querySelector('.cm-content')?.textContent).toContain('external edit'));
    useEditorStore.getState().clear(path);
  });

});
