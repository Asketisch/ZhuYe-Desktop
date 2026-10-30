import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { KmsView } from './KmsView';
import { ConfirmDialogHost } from '@/features/modals/ConfirmDialog';

const content = '---\ntitle: Title\ntags: [tag]\n---\nbody\n';
const save = vi.fn(async (_command: string, args?: Record<string, unknown>) => args);

beforeEach(() => {
  resetMockInvoke();
  save.mockClear();
  mockInvoke('reflect_kms_list', async () => [
    { name: 'first', description: null, path: '/first', pageCount: 1, modifiedAtMs: 0 },
    { name: 'second', description: null, path: '/second', pageCount: 0, modifiedAtMs: 0 },
  ]);
  mockInvoke('reflect_kms_list_pages', async (_command, args) => args?.wiki === 'first'
    ? [{ name: 'page', wiki: 'first', content, title: 'Title', tags: ['tag'], modifiedAtMs: 0 }] : []);
  mockInvoke('reflect_kms_save_page', save);
});

function renderView() {
  return render(<QueryClientProvider client={createTestQueryClient()}><KmsView /><ConfirmDialogHost /></QueryClientProvider>);
}

it('keeps the draft tied to its wiki and saves the full page unchanged', async () => {
  renderView();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(await screen.findByText('page'));
  expect((screen.getByText('second') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByPlaceholderText('Write your page content in Markdown...') as HTMLTextAreaElement).value).toBe(content);
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalledWith('reflect_kms_save_page', {
    wiki: 'first', page: 'page', content, title: null, tags: null, expectedContent: content,
  }));
  await waitFor(() => expect((screen.getByText('second') as HTMLButtonElement).disabled).toBe(false));
});

it('keeps a failed save draft visible', async () => {
  save.mockRejectedValueOnce({ msg: 'disk full' });
  renderView();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(await screen.findByText('page'));
  fireEvent.click(screen.getByText('Save'));
  expect(await screen.findByText('Failed to save the page. Your draft is still available.')).toBeDefined();
  expect(screen.getByRole('alert').textContent).toContain('disk full');
  expect((screen.getByPlaceholderText('Write your page content in Markdown...') as HTMLTextAreaElement).value).toBe(content);
});

it('keeps an edited draft when the original page has changed', async () => {
  save.mockRejectedValueOnce({ msg: 'Page changed or was deleted: first/page' });
  renderView();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(await screen.findByText('page'));
  const editor = screen.getByPlaceholderText('Write your page content in Markdown...') as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: 'my draft' } });
  fireEvent.click(screen.getByText('Save'));
  expect((await screen.findByRole('alert')).textContent).toContain('Page changed or was deleted');
  expect(editor.value).toBe('my draft');
  expect(save).toHaveBeenCalledWith('reflect_kms_save_page', {
    wiki: 'first', page: 'page', content: 'my draft', title: null, tags: null, expectedContent: content,
  });
});

it('reports failure to load knowledge bases', async () => {
  mockInvoke('reflect_kms_list', async () => { throw new Error('list unavailable'); });
  renderView();
  expect((await screen.findByRole('alert')).textContent).toContain('list unavailable');
  expect(screen.queryByText('No knowledge bases')).toBeNull();
});

it('uses exclusive creation for a new page and keeps the draft if the name exists', async () => {
  save.mockRejectedValueOnce({ msg: 'Page already exists' });
  renderView();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(screen.getByText('New Page'));
  fireEvent.change(screen.getByPlaceholderText('Page name (e.g. api-design)'), { target: { value: 'page' } });
  fireEvent.change(screen.getByPlaceholderText('Write your page content in Markdown...'), { target: { value: 'draft' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalledWith('reflect_kms_save_page', {
    wiki: 'first', page: 'page', content: 'draft', title: null, tags: null, createOnly: true,
  }));
  expect(await screen.findByText('Failed to save the page. Your draft is still available.')).toBeDefined();
  expect((screen.getByPlaceholderText('Write your page content in Markdown...') as HTMLTextAreaElement).value).toBe('draft');
});

it('uses exclusive creation when an existing page is saved under a different name', async () => {
  renderView();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(await screen.findByText('page'));
  fireEvent.change(screen.getByPlaceholderText('Page name (e.g. api-design)'), { target: { value: 'other' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(save).toHaveBeenCalledWith('reflect_kms_save_page', {
    wiki: 'first', page: 'other', content, title: null, tags: null, createOnly: true,
  }));
});

it('shows creation errors and preserves the entered name and description', async () => {
  mockInvoke('reflect_kms_create', async () => { throw { msg: 'Wiki already exists' }; });
  renderView();
  fireEvent.click(await screen.findByText('New'));
  fireEvent.change(screen.getByPlaceholderText('Wiki name (e.g. engineering)'), { target: { value: 'first' } });
  fireEvent.change(screen.getByPlaceholderText('Description (optional)'), { target: { value: 'draft description' } });
  fireEvent.click(screen.getByText('Create'));
  expect((await screen.findByRole('alert')).textContent).toContain('Wiki already exists');
  expect((screen.getByPlaceholderText('Wiki name (e.g. engineering)') as HTMLInputElement).value).toBe('first');
  expect((screen.getByPlaceholderText('Description (optional)') as HTMLInputElement).value).toBe('draft description');
});

it('reports page loading errors instead of showing an empty page list', async () => {
  mockInvoke('reflect_kms_list_pages', async () => { throw { msg: 'Access denied' }; });
  renderView();
  fireEvent.click(await screen.findByText('first'));
  expect((await screen.findByRole('alert')).textContent).toContain('Access denied');
  expect(screen.queryByText('No pages yet')).toBeNull();
});

it('does not allow edits to a wiki creation form while the request is pending', async () => {
  let resolve!: (value: unknown) => void;
  mockInvoke('reflect_kms_create', () => new Promise((done) => { resolve = done; }));
  renderView();
  fireEvent.click(await screen.findByText('New'));
  const name = screen.getByPlaceholderText('Wiki name (e.g. engineering)') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'draft' } });
  fireEvent.click(screen.getByText('Create'));
  await waitFor(() => expect(name.disabled).toBe(true));
  expect((screen.getByText('New').closest('button') as HTMLButtonElement).disabled).toBe(true);
  resolve({ name: 'draft' });
  await waitFor(() => expect(screen.queryByPlaceholderText('Wiki name (e.g. engineering)')).toBeNull());
});

it('refreshes page counts and active search results after a page is saved', async () => {
  let saved = false;
  mockInvoke('reflect_kms_list', async () => [
    { name: 'first', description: null, path: '/first', pageCount: saved ? 2 : 1, modifiedAtMs: 0 },
  ]);
  mockInvoke('reflect_kms_search', async () => [{
    wiki: 'first', page: 'page', lines: [saved ? 'updated result' : 'old result'], lineCount: 1,
  }]);
  save.mockImplementationOnce(async (_command, args) => { saved = true; return args; });
  renderView();
  fireEvent.change(screen.getByPlaceholderText('Search across all knowledge bases...'), { target: { value: 'result' } });
  expect(await screen.findByText('old result')).toBeDefined();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(await screen.findByText('page'));
  fireEvent.click(screen.getByText('Save'));
  expect(await screen.findByText('updated result')).toBeDefined();
  await waitFor(() => expect(screen.getByRole('button', { name: /first/ }).textContent).toContain('2'));
});

it('refreshes active search results after deleting a wiki', async () => {
  let deleted = false;
  mockInvoke('reflect_kms_list', async () => deleted ? [] : [
    { name: 'first', description: null, path: '/first', pageCount: 1, modifiedAtMs: 0 },
  ]);
  mockInvoke('reflect_kms_search', async () => deleted ? [] : [{
    wiki: 'first', page: 'page', lines: ['old result'], lineCount: 1,
  }]);
  mockInvoke('reflect_kms_delete', async () => { deleted = true; });
  renderView();
  fireEvent.change(screen.getByPlaceholderText('Search across all knowledge bases...'), { target: { value: 'result' } });
  expect(await screen.findByText('old result')).toBeDefined();
  fireEvent.click(await screen.findByText('first'));
  fireEvent.click(screen.getByText('Delete Wiki'));
  fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
  await waitFor(() => expect(screen.queryByText('old result')).toBeNull());
  expect(await screen.findByText('No knowledge bases')).toBeDefined();
});
