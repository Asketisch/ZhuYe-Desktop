/**
 * Vitest —— DisplaySection 行为测试(v1.11 桌面#4:锁定发送设置开关)。
 *
 * 设置 > 显示 > 编辑器「Enter 发送」开关:
 * - 复选框状态与 uiPrefs.sendOnEnter 同步(默认开)
 * - 切换开关 → 偏好落库(localStorage)
 * - 关闭时开关旁出现 lock 徽标(向用户言明当前处于锁定发送)
 *
 * SSR 证据在 DisplaySection.ssr.test.tsx;这里只测交互行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { DisplaySection } from '@/features/harness/settings/sections/DisplaySection';
import { getUiPrefs, resetUiPrefsForTests } from '@/utils/uiPrefs';

describe('DisplaySection — sendOnEnter toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUiPrefsForTests();
  });
  afterEach(() => {
    cleanup();
    resetUiPrefsForTests();
  });

  it('renders checked by default and persists the toggle to uiPrefs', () => {
    render(
      <I18nProvider>
        <DisplaySection />
      </I18nProvider>,
    );
    const box = screen.getByTestId('settings-send-on-enter') as HTMLInputElement;
    // 默认 Enter 发送 = 勾选。
    expect(box.checked).toBe(true);
    // 关闭 → 偏好落库。
    fireEvent.click(box);
    expect(getUiPrefs().sendOnEnter).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('zhuye.uiprefs.v1') ?? '{}').sendOnEnter,
    ).toBe(false);
    // 再开 → 恢复。
    fireEvent.click(screen.getByTestId('settings-send-on-enter'));
    expect(getUiPrefs().sendOnEnter).toBe(true);
  });

  it('shows the lock badge only when sendOnEnter is off', () => {
    render(
      <I18nProvider>
        <DisplaySection />
      </I18nProvider>,
    );
    const box = screen.getByTestId('settings-send-on-enter') as HTMLInputElement;
    // 默认(开)无 lock 徽标。
    expect(screen.queryByText('lock')).toBeNull();
    fireEvent.click(box);
    expect(screen.getByText('lock')).toBeDefined();
  });
});
