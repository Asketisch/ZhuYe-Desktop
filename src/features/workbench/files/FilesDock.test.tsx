/**
 * FilesDock —— 右 dock 文件面板行为测试。
 *
 * 覆盖：根目录树渲染 + 副标题、目录懒加载展开、点击文件出预览（相对路径 + 徽标）、
 * git 状态徽标（M / U）、过滤器按 git 状态收窄（已修改 / 未跟踪，含自动展开）、
 * git 不可用时隐藏过滤器行、折叠开关。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { mockInvoke, renderWithQueryClient } from '@/test/setup';
import { FilesDock } from './FilesDock';

const WS = '/repo';

function renderDock() {
  return renderWithQueryClient(
    <I18nProvider>
      <FilesDock />
    </I18nProvider>,
  );
}

function entry(name: string, path: string, kind: 'dir' | 'file', depth = 0) {
  return { name, path, kind, size: kind === 'file' ? 120 : 0, mtime: 0, depth };
}

/** 安装本套件的默认命令桩（setup.tsx 的全局桩之后执行，逐条覆写）。 */
function installDefaultMocks() {
  mockInvoke('zhuye_current_workspace', async () => WS);
  mockInvoke('zhuye_list_dir', async (_cmd: string, args?: { path?: string | null }) => {
    const root = args?.path ?? WS;
    if (root === WS) {
      return {
        root: WS,
        truncated: false,
        entries: [
          entry('src', `${WS}/src`, 'dir'),
          entry('README.md', `${WS}/README.md`, 'file'),
          entry('notes.txt', `${WS}/notes.txt`, 'file'),
        ],
      };
    }
    if (root === `${WS}/src`) {
      return {
        root: `${WS}/src`,
        truncated: false,
        entries: [
          entry('main.ts', `${WS}/src/main.ts`, 'file', 1),
          entry('lib.rs', `${WS}/src/lib.rs`, 'file', 1),
        ],
      };
    }
    return { root, truncated: false, entries: [] };
  });
  mockInvoke('zhuye_git_status', async () => ({
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    is_repo: true,
    raw: '',
    entries: [
      { path: 'README.md', status: 'M', staged: false, old_path: null },
      { path: 'src/lib.rs', status: '??', staged: false, old_path: null },
    ],
  }));
  mockInvoke('zhuye_read_file', async (_cmd: string, args?: { path?: string }) => ({
    path: args?.path ?? '',
    content: args?.path?.endsWith('README.md') ? '# hello' : 'const x = 1;\n',
    size: 16,
    binary: false,
    truncated: false,
  }));
}

beforeEach(() => {
  installDefaultMocks();
});

describe('FilesDock', () => {
  it('渲染根目录条目与副标题', async () => {
    renderDock();
    expect(await screen.findByTestId('files-dock-file-README.md')).toBeDefined();
    expect(screen.getByTestId('files-dock-dir-src')).toBeDefined();
    expect(screen.getByTestId('files-dock-file-notes.txt')).toBeDefined();
    // 副标题 = 条目数 + 工作区 basename（中英文案都兼容）
    await waitFor(() => expect(screen.getByText(/items · repo|项 · repo/)).toBeDefined());
  });

  it('点击目录懒加载子条目', async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId('files-dock-dir-src'));
    expect(await screen.findByTestId('files-dock-file-main.ts')).toBeDefined();
    expect(screen.getByTestId('files-dock-file-lib.rs')).toBeDefined();
  });

  it('点击文件加载预览内容', async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId('files-dock-file-README.md'));
    expect(await screen.findByText('# hello')).toBeDefined();
    // 预览头部：相对路径 + 扩展名徽标
    const preview = screen.getByTestId('files-dock-preview');
    expect(within(preview).getByText('README.md')).toBeDefined();
    expect(within(preview).getByText('MD')).toBeDefined();
  });

  it('文件行显示 git 状态徽标（M / U）', async () => {
    renderDock();
    const readme = await screen.findByTestId('files-dock-file-README.md');
    expect(readme.querySelector('.st.mod')?.textContent).toBe('M');
    fireEvent.click(screen.getByTestId('files-dock-dir-src'));
    const lib = await screen.findByTestId('files-dock-file-lib.rs');
    expect(lib.querySelector('.st.add')?.textContent).toBe('U');
    // 未改动的文件没有徽标
    expect(screen.getByTestId('files-dock-file-main.ts').querySelector('.st')).toBeNull();
  });

  it('过滤器按 git 状态收窄（已修改 / 未跟踪）', async () => {
    renderDock();
    await screen.findByTestId('files-dock-file-README.md');
    // 已修改：README.md 保留，未改动文件隐藏；src 尚未加载故目录行保留
    fireEvent.click(screen.getByTestId('files-dock-filter-modified'));
    await waitFor(() => expect(screen.queryByTestId('files-dock-file-notes.txt')).toBeNull());
    expect(screen.getByTestId('files-dock-file-README.md')).toBeDefined();
    expect(screen.queryByTestId('files-dock-file-main.ts')).toBeNull();
    // 未跟踪：src 被自动展开，lib.rs（??）出现，README（M）隐藏
    fireEvent.click(screen.getByTestId('files-dock-filter-untracked'));
    expect(await screen.findByTestId('files-dock-file-lib.rs')).toBeDefined();
    expect(screen.queryByTestId('files-dock-file-README.md')).toBeNull();
    expect(screen.queryByTestId('files-dock-file-main.ts')).toBeNull();
  });

  it('git 不可用时隐藏过滤器行', async () => {
    mockInvoke('zhuye_git_status', async () => ({
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      is_repo: false,
      raw: '',
      entries: [],
    }));
    renderDock();
    await screen.findByTestId('files-dock-file-README.md');
    expect(screen.queryByTestId('files-dock-filter-all')).toBeNull();
    expect(screen.queryByTestId('files-dock-filter-modified')).toBeNull();
  });

  it('折叠开关切换目录树可见性', async () => {
    renderDock();
    await screen.findByTestId('files-dock-file-README.md');
    const tree = screen.getByTestId('files-dock-tree');
    expect(tree.className).not.toContain('collapsed');
    fireEvent.click(screen.getByTestId('files-dock-collapse'));
    expect(tree.className).toContain('collapsed');
    // 再点一次恢复
    fireEvent.click(screen.getByTestId('files-dock-collapse'));
    expect(tree.className).not.toContain('collapsed');
  });
});
