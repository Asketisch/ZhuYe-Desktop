/**
 * AttachmentBar —— 附件预览条测试:inline image 缩略图 + 文字 chip + 删除
 * + A3 状态机(pending/error 展示与重试)。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentBar } from './AttachmentBar';
import type { StagedAttachment } from '@/logic/composer/useAttachments';

const base: StagedAttachment[] = [
  {
    id: 'a1',
    status: 'ready',
    attachment: { kind: 'image', data: 'data:image/png;base64,AAAA', mime_type: 'image/png', source: { channel: 'paste' } },
  },
  {
    id: 'a2',
    status: 'ready',
    attachment: { kind: 'file', path: 'src/app.tsx', range: { start_line: 1, end_line: 9 } },
  },
  {
    id: 'a3',
    status: 'ready',
    attachment: { kind: 'local_image', path: '/tmp/shot.png' },
  },
];

describe('AttachmentBar', () => {
  it('renders a real thumbnail for inline image attachments', () => {
    render(<AttachmentBar attachments={base} onRemove={vi.fn()} />);
    const thumb = screen.getByTestId('attachment-thumb') as HTMLImageElement;
    expect(thumb.src).toBe('data:image/png;base64,AAAA');
    expect(screen.getByTestId('attachment-bar').textContent).toContain('image/png');
  });

  it('renders text labels for file mentions and local images', () => {
    render(<AttachmentBar attachments={base} onRemove={vi.fn()} />);
    expect(screen.getByTestId('attachment-bar').textContent).toContain('src/app.tsx');
    expect(screen.getByTestId('attachment-bar').textContent).toContain('L1-9');
    expect(screen.getByTestId('attachment-bar').textContent).toContain('/tmp/shot.png');
  });

  it('emits remove with the attachment index', () => {
    const onRemove = vi.fn();
    render(<AttachmentBar attachments={base} onRemove={onRemove} />);
    fireEvent.click(screen.getByTestId('attachment-remove-1'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('marks error chips with retry and pending chips without', () => {
    const onRetry = vi.fn();
    const staged: StagedAttachment[] = [
      {
        id: 'b1',
        status: 'error',
        attachment: { kind: 'browser_file', path: 'notes.txt', source: new File([], 'notes.txt') },
      },
      {
        id: 'b2',
        status: 'pending',
        attachment: { kind: 'browser_file', path: 'big.bin', source: new File([], 'big.bin') },
      },
    ];
    render(<AttachmentBar attachments={staged} onRemove={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByTestId('attachment-retry-0')).toBeTruthy();
    expect(screen.queryByTestId('attachment-retry-1')).toBeNull();
    fireEvent.click(screen.getByTestId('attachment-retry-0'));
    expect(onRetry).toHaveBeenCalledWith('b1');
  });

  it('renders nothing without attachments', () => {
    const { container } = render(<AttachmentBar attachments={[]} onRemove={vi.fn()} />);
    expect(container.querySelector('[data-testid="attachment-bar"]')).toBeNull();
  });
});
