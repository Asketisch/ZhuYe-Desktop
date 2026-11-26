/**
 * ActivityBar 组件测试 —— simple（默认）/ full（开发者模式）双模式。
 *
 * - simple：只平铺 Chat / Search + 「更多」浮层 + Settings；
 *   其余视图收进浮层（按 开发工具 / 自动化 / 更多功能 分组）。
 * - full：17 个视图全部平铺（历史行为，Settings → Display 开启）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { getUiPrefs, setUiPrefs } from '@/utils/uiPrefs';
import { ActivityBar } from './ActivityBar';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: navigateMock }),
  useLocation: () => ({ pathname: '/' }),
}));

function renderBar() {
  return render(
    <I18nProvider>
      <ActivityBar />
    </I18nProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  setUiPrefs({ activityBarMode: 'simple' });
});

describe('ActivityBar simple mode (default)', () => {
  it('shows only Chat / Search / More / Settings entry points', () => {
    renderBar();
    expect(screen.getByLabelText('Chat')).toBeDefined();
    expect(screen.getByLabelText('Search')).toBeDefined();
    expect(screen.getByLabelText('More')).toBeDefined();
    expect(screen.getByLabelText('Settings')).toBeDefined();
    // 高级视图不默认平铺。
    expect(screen.queryByLabelText('Terminal')).toBeNull();
    expect(screen.queryByLabelText('Git')).toBeNull();
    // data-mode 供浮层 overflow CSS 使用。
    expect(screen.getByRole('navigation').getAttribute('data-mode')).toBe('simple');
  });

  it('opens the grouped flyout and navigates from it', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('activitybar-more'));
    const flyout = screen.getByTestId('activitybar-more-flyout');
    expect(flyout).toBeDefined();
    // 三组分组标题 + 其中条目可见。
    expect(screen.getByText('Developer tools')).toBeDefined();
    expect(screen.getByText('Automation')).toBeDefined();
    expect(screen.getByText('More features')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();

    fireEvent.click(screen.getByText('Terminal'));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/terminal' });
    // 导航后浮层关闭。
    expect(screen.queryByTestId('activitybar-more-flyout')).toBeNull();
  });

  it('closes the flyout on Escape', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('activitybar-more'));
    expect(screen.getByTestId('activitybar-more-flyout')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('activitybar-more-flyout')).toBeNull();
  });

  it('marks Chat active on root path', () => {
    renderBar();
    expect(screen.getByLabelText('Chat').getAttribute('aria-current')).toBe('page');
  });
});

describe('ActivityBar full mode (developer)', () => {
  beforeEach(() => {
    setUiPrefs({ activityBarMode: 'full' });
  });

  it('flattens every view back into the bar', () => {
    renderBar();
    expect(screen.getByLabelText('Home')).toBeDefined();
    expect(screen.getByLabelText('Chat')).toBeDefined();
    expect(screen.getByLabelText('Files')).toBeDefined();
    expect(screen.getByLabelText('Git')).toBeDefined();
    expect(screen.getByLabelText('Terminal')).toBeDefined();
    expect(screen.getByLabelText('Media')).toBeDefined();
    expect(screen.getByLabelText('About')).toBeDefined();
    // full 模式无「更多」浮层入口。
    expect(screen.queryByTestId('activitybar-more')).toBeNull();
    expect(getUiPrefs().activityBarMode).toBe('full');
  });
});
