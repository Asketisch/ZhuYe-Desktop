/**
 * Vitest — ContextBanner（上下文压缩预警横幅）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { mockInvoke } from '@/test/setup';
import { ContextBanner } from './ContextBanner';

function renderBanner() {
  return render(<I18nProvider><ContextBanner /></I18nProvider>);
}

beforeEach(() => {
  useAgentStore.getState().reset();
  window.localStorage.clear();
});

describe('ContextBanner', () => {
  const setUsage = (total: number, windowSize: number | null) => {
    useAgentStore.setState({
      tokens: {
        input: total, output: 0, cached: 0, cacheWrite: 0, total, cost: null,
        provider: null, credentialLabel: null,
      },
      contextWindowSize: windowSize,
    } as never);
  };

  it('stays hidden below the 80% threshold', () => {
    setUsage(500_000, 1_000_000);
    const { container } = renderBanner();
    expect(container.querySelector('[data-testid="context-warning-banner"]')).toBeNull();
  });

  it('appears at ≥80% and compact button calls zhuye_compact', async () => {
    const compacts: number[] = [];
    mockInvoke('zhuye_compact', async () => {
      compacts.push(1);
      return 'op-1';
    });
    setUsage(850_000, 1_000_000);
    renderBanner();
    const banner = screen.getByTestId('context-warning-banner');
    expect(banner.textContent).toContain('85%');

    fireEvent.click(screen.getByTestId('context-compact-btn'));
    await waitFor(() => expect(compacts).toHaveLength(1));
  });

  it('dismisses while usage stays flat', () => {
    setUsage(900_000, 1_000_000);
    renderBanner();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('context-warning-banner')).toBeNull();
  });
});
