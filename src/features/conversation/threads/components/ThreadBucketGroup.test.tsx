/**
 * Vitest — ThreadBucketGroup 测试。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThreadBucketGroup } from '@/features/conversation/threads/components/ThreadBucketGroup';
import type { SessionBucket } from '@/features/conversation/sessions';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router');
  return {
    ...actual,
    Link: ({
      children,
      to,
      onClick,
      style,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
      onClick?: () => void;
      style?: React.CSSProperties;
      [k: string]: unknown;
    }) => (
      <a href={to} onClick={onClick} style={style} {...rest}>
        {children}
      </a>
    ),
  };
});

const NOW = Date.now();

function bucket(): SessionBucket {
  return {
    label: 'Now',
    sessions: [
      {
        session_id: 's1',
        model: 'stub/test',
        started_at: new Date(NOW - 30 * 60 * 1000).toISOString(),
        message_count: 2,
      },
    ],
  };
}

describe('ThreadBucketGroup', () => {
  const noop = () => Promise.resolve();
  const noopExport = () => Promise.resolve(null);

  it('renders bucket label and session', () => {
    render(
      <ThreadBucketGroup
        bucket={bucket()}
        activeId={null}
        onSelect={vi.fn()}
        onRename={noop}
        onDelete={noop}
        onExport={noopExport}
      />,
    );
    expect(screen.getByText('Now')).toBeDefined();
    // session_id "s1" → displayTitle 返回 id 前缀。
    expect(screen.getByText('s1')).toBeDefined();
    expect(screen.getByText(/2 message/)).toBeDefined();
  });

  it('marks active item', () => {
    const { container } = render(
      <ThreadBucketGroup
        bucket={bucket()}
        activeId="s1"
        onSelect={vi.fn()}
        onRename={noop}
        onDelete={noop}
        onExport={noopExport}
      />,
    );
    const link = container.querySelector('a[data-active="true"]');
    expect(link).not.toBeNull();
  });

  it('renders bucket label and session content', () => {
    const { container } = render(
      <ThreadBucketGroup
        bucket={bucket()}
        activeId={null}
        onSelect={vi.fn()}
        onRename={noop}
        onDelete={noop}
        onExport={noopExport}
      />,
    );
    expect(container.querySelector('[data-bucket="Now"]')).not.toBeNull();
    expect(container.textContent).toContain('s1');
    expect(container.textContent).toContain('2 message');
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ThreadBucketGroup
        bucket={bucket()}
        activeId={null}
        onSelect={onSelect}
        onRename={noop}
        onDelete={noop}
        onExport={noopExport}
      />,
    );
    const link = container.querySelector('a')!;
    link.click();
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('renders multiple sessions', () => {
    const b: SessionBucket = {
      label: 'Today',
      sessions: [
        { ...bucket().sessions[0], session_id: 's1' },
        { ...bucket().sessions[0], session_id: 's2' },
      ],
    };
    render(
      <ThreadBucketGroup
        bucket={b}
        activeId={null}
        onSelect={vi.fn()}
        onRename={noop}
        onDelete={noop}
        onExport={noopExport}
      />,
    );
    expect(screen.getByText('s1')).toBeDefined();
    expect(screen.getByText('s2')).toBeDefined();
  });
});