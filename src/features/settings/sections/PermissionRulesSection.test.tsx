/**
 * Vitest — PermissionRulesSection 测试(核心权限层的生效规则)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PermissionRulesSection } from './PermissionRulesSection';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const RULES = [
  {
    tool: 'Bash',
    action: 'deny',
    toolGlob: null,
    shellPattern: 'rm -rf *',
    scope: 'config' as const,
  },
  {
    tool: 'Read',
    action: 'allow',
    toolGlob: null,
    shellPattern: null,
    scope: 'user' as const,
  },
];

describe('PermissionRulesSection', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the effective rules with action and scope', async () => {
    mockInvoke('reflect_list_permission_rules', async () => RULES);
    render(wrap(<PermissionRulesSection />));

    const rows = await screen.findAllByTestId('permission-rule-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('deny');
    expect(rows[0].textContent).toContain('Bash');
    expect(rows[0].textContent).toContain('rm -rf *');
    expect(rows[0].textContent).toContain('config');
    expect(rows[1].textContent).toContain('allow');
    expect(rows[1].textContent).toContain('user');
  });

  it('renders the empty state when no rules are configured', async () => {
    mockInvoke('reflect_list_permission_rules', async () => []);
    render(wrap(<PermissionRulesSection />));
    expect(await screen.findByText(/No permission rules/i)).toBeDefined();
  });

  it('surfaces query errors without crashing', async () => {
    mockInvoke('reflect_list_permission_rules', async () => {
      throw new Error('permissions.toml unreadable');
    });
    render(wrap(<PermissionRulesSection />));
    expect(await screen.findByText(/permissions.toml unreadable/i)).toBeDefined();
  });
});
