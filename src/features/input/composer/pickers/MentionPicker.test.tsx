/**
 * Vitest — MentionPicker（`@` 文件弹层）。
 *
 * 验证:
 * 1. visible=true 时拉取 `zhuye_list_dir`（path=null, maxDepth=2）
 * 2. 仅文件可被选取, 目录不出现在选项中
 * 3. query 走 fuzzy 过滤（name / path 命中）
 * 4. 点击条目触发 onPickFile(相对路径) + onClose
 * 5. 后端返回绝对路径时,onPickFile / hint 展示的是剥离 root 前缀的相对路径
 * 6. visible=false 不渲染、不拉取
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import { MentionPicker } from './MentionPicker';
import type { MentionPickerProps } from './MentionPicker';
import type { ZhuyeDirEntry } from '@/utils/commands';

function entry(name: string, path: string, kind: 'file' | 'dir' = 'file'): ZhuyeDirEntry {
  return { name, path, kind, size: 10, mtime: 0, depth: 1 };
}

function renderPicker(props: Partial<MentionPickerProps>) {
  return render(
    <I18nProvider>
      <MentionPicker
        visible={props.visible ?? true}
        query={props.query ?? ''}
        onPickFile={props.onPickFile ?? vi.fn()}
        onClose={props.onClose ?? vi.fn()}
        workspaceLabel={props.workspaceLabel}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  resetMockInvoke();
});

function mockListing(entries: ZhuyeDirEntry[]) {
  mockInvoke('zhuye_list_dir', async () => ({
    root: '/tmp/proj',
    entries,
    truncated: false,
  }));
}

describe('MentionPicker', () => {
  it('does not render or fetch when hidden', async () => {
    let fetched = false;
    mockInvoke('zhuye_list_dir', async () => {
      fetched = true;
      return { root: '/tmp/proj', entries: [], truncated: false };
    });
    const { container } = renderPicker({ visible: false });
    expect(container.querySelector('[data-testid="mention-picker"]')).toBeNull();
    expect(fetched).toBe(false);
  });

  it('fetches the workspace listing and lists files (not dirs)', async () => {
    const seenArgs: unknown[] = [];
    mockInvoke('zhuye_list_dir', async (_cmd, args) => {
      seenArgs.push(args);
      return {
        root: '/tmp/proj',
        entries: [
          entry('README.md', 'README.md'),
          entry('src', 'src', 'dir'),
          entry('main.ts', 'src/main.ts'),
        ],
        truncated: false,
      };
    });
    renderPicker({});

    await screen.findByTestId('mention-file-README.md');
    // 文件出现, 目录不出现。
    expect(screen.getByTestId('mention-file-main.ts')).toBeDefined();
    expect(screen.queryByTestId('mention-file-src')).toBeNull();

    // 走的是 path=null（当前工作区）+ depth=2。
    expect(seenArgs[0]).toEqual({ path: null, maxDepth: 2 });
  });

  it('fuzzy-filters by query and picks the file on click', async () => {
    mockListing([
      entry('README.md', 'README.md'),
      entry('main.ts', 'src/main.ts'),
      entry('config.ts', 'src/config.ts'),
    ]);
    const onPickFile = vi.fn();
    const onClose = vi.fn();
    renderPicker({ query: 'main', onPickFile, onClose });

    const item = await screen.findByTestId('mention-file-main.ts');
    expect(screen.queryByTestId('mention-file-README.md')).toBeNull();
    fireEvent.click(item);
    expect(onPickFile).toHaveBeenCalledWith('src/main.ts');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('strips the workspace root prefix from absolute paths before onPickFile', async () => {
    // 后端 DirEntry.path 是绝对路径 —— 选择/hint 必须是工作区相对路径
    // (协议契约: UserInputItem.File.path 相对路径)。
    mockListing([
      entry('main.ts', '/tmp/proj/src/main.ts'),
      entry('top.md', '/tmp/proj/top.md'),
    ]);
    const onPickFile = vi.fn();
    renderPicker({ onPickFile });

    const item = await screen.findByTestId('mention-file-main.ts');
    // hint 展示的是相对路径,不是绝对路径。
    expect(item.textContent).toContain('src/main.ts');
    expect(item.textContent).not.toContain('/tmp/proj');

    fireEvent.click(item);
    expect(onPickFile).toHaveBeenCalledWith('src/main.ts');
  });

  it('shows the empty state when nothing matches', async () => {
    mockListing([entry('main.ts', 'src/main.ts')]);
    renderPicker({ query: 'zzz-not-there' });

    await waitFor(() =>
      expect(screen.getByText('No matching files.')).toBeDefined(),
    );
  });
});
