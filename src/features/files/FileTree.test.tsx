/**
 * Vitest — FileTree (B9-01).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from './FileTree';
import type { ZhuyeDirEntry } from '@/utils/commands';

const ENTRIES: ZhuyeDirEntry[] = [
  { name: 'src', path: '/r/src', kind: 'dir', size: 0, mtime: 0, depth: 0 },
  { name: 'README.md', path: '/r/README.md', kind: 'file', size: 12, mtime: 0, depth: 0 },
  { name: 'main.ts', path: '/r/src/main.ts', kind: 'file', size: 99, mtime: 0, depth: 1 },
  { name: 'App.tsx', path: '/r/src/App.tsx', kind: 'file', size: 220, mtime: 0, depth: 1 },
];

describe('FileTree', () => {
  it('renders top-level entries by default', () => {
    render(<FileTree entries={ENTRIES} />);
    expect(screen.getByTestId('file-tree')).toBeDefined();
    expect(screen.getByText('src')).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
  });

  it('expands a directory on click and reveals children', () => {
    render(<FileTree entries={ENTRIES} />);
    // 顶层目录默认展开，因此 main.ts / App.tsx 应当已经可见
    expect(screen.getByText('main.ts')).toBeDefined();
    expect(screen.getByText('App.tsx')).toBeDefined();
  });

  it('fires onSelectFile when a file row is clicked', () => {
    const onSelect = vi.fn();
    render(<FileTree entries={ENTRIES} onSelectFile={onSelect} />);
    fireEvent.click(screen.getByTestId('file-row-README.md'));
    expect(onSelect).toHaveBeenCalledWith('/r/README.md');
  });

  it('marks the selected file with data-selected', () => {
    render(<FileTree entries={ENTRIES} selectedPath="/r/README.md" />);
    const row = screen.getByTestId('file-row-README.md');
    expect(row.getAttribute('data-selected')).toBe('true');
  });

  it('renders empty state when given no entries', () => {
    render(<FileTree entries={[]} />);
    expect(screen.getByTestId('file-tree-empty')).toBeDefined();
  });
});