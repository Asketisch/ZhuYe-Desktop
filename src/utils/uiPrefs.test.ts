import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCENT_COLOR,
  applyUiPrefs,
  getUiPrefs,
  resetUiPrefsForTests,
  resolveBodyBackground,
  setUiPrefs,
  subscribeUiPrefs,
} from '@/utils/uiPrefs';

describe('uiPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUiPrefsForTests();
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    delete document.documentElement.dataset.reduceTransparency;
    delete document.documentElement.dataset.hasBackgroundImage;
  });

  it('loads appearance defaults for older persisted preferences', () => {
    localStorage.setItem('zhuye.uiprefs.v1', JSON.stringify({ chatDiffSplit: true }));
    const prefs = getUiPrefs();
    expect(prefs.chatDiffSplit).toBe(true);
    expect(prefs.accentColor).toBe(DEFAULT_ACCENT_COLOR);
    expect(prefs.surfaceOpacity).toBe(1);
    expect(prefs.backgroundImage).toBe('');
  });

  // ── v1.11 桌面#4:锁定发送开关的持久化口径 ──────────────────────

  it('sendOnEnter defaults to true, roundtrips false, and tolerates legacy/invalid values', () => {
    // 缺省:Enter 发送(既有行为,老用户无感)。
    expect(getUiPrefs().sendOnEnter).toBe(true);
    // 关闭 → 落盘 + 回读保持。
    setUiPrefs({ sendOnEnter: false });
    expect(getUiPrefs().sendOnEnter).toBe(false);
    expect(
      JSON.parse(localStorage.getItem('zhuye.uiprefs.v1') ?? '{}').sendOnEnter,
    ).toBe(false);
    // 旧版本持久化里没有该键 → 回退默认 true。
    resetUiPrefsForTests();
    localStorage.clear();
    localStorage.setItem('zhuye.uiprefs.v1', JSON.stringify({ chatDiffSplit: true }));
    expect(getUiPrefs().sendOnEnter).toBe(true);
    // 非法类型(手改 localStorage)→ 回退默认 true,不炸。
    resetUiPrefsForTests();
    localStorage.clear();
    localStorage.setItem('zhuye.uiprefs.v1', JSON.stringify({ sendOnEnter: 'yes' }));
    expect(getUiPrefs().sendOnEnter).toBe(true);
  });

  it('persists updates, clamps ranges, and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUiPrefs(listener);
    setUiPrefs({ surfaceOpacity: 0.1, backgroundImageOpacity: 2 });
    expect(getUiPrefs().surfaceOpacity).toBe(0.5);
    expect(getUiPrefs().backgroundImageOpacity).toBe(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('zhuye.uiprefs.v1') ?? '{}').surfaceOpacity).toBe(0.5);
    unsubscribe();
  });

  it('rejects invalid accent colors and unsafe image schemes', () => {
    setUiPrefs({ accentColor: 'red', backgroundImage: 'javascript:alert(1)' });
    expect(getUiPrefs().accentColor).toBe(DEFAULT_ACCENT_COLOR);
    expect(getUiPrefs().backgroundImage).toBe('');
  });

  it('applies accent derivatives, opacity, and image variables to the DOM', () => {
    applyUiPrefs({
      ...getUiPrefs(),
      accentColor: '#60a5fa',
      surfaceOpacity: 0.72,
      backgroundImage: 'https://example.com/background.jpg',
      backgroundImageOpacity: 0.4,
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--accent')).toBe('#60a5fa');
    expect(style.getPropertyValue('--accent-subtle')).toContain('96, 165, 250');
    expect(style.getPropertyValue('--surface-opacity')).toBe('0.72');
    expect(style.getPropertyValue('--background-image')).toContain('example.com/background.jpg');
    expect(document.documentElement.dataset.hasBackgroundImage).toBe('true');
  });

  it('sets the reduce-transparency DOM switch', () => {
    applyUiPrefs({ ...getUiPrefs(), reduceTransparency: true });
    expect(document.documentElement.dataset.reduceTransparency).toBe('true');
  });

  it('computes body background as rgba(11,14,20, 0.5) when surfaceOpacity=0.5', () => {
    document.head.innerHTML = `<style>:root { --bg-app-rgb: 11, 14, 20; }</style>`;
    setUiPrefs({ surfaceOpacity: 0.5 });
    applyUiPrefs(getUiPrefs());
    // resolveBodyBackground 直接产出 alpha 通道字面量(jsdom 规范化后内部通道间补空格)
    expect(resolveBodyBackground(getUiPrefs())).toMatch(/^rgba\(11, ?14, ?20, ?0\.5\)$/);
    // applyUiPrefs 同步写到 body.style.backgroundColor
    expect(document.body.style.backgroundColor).toMatch(/^rgba\(11, ?14, ?20, ?0\.5\)$/);
    // getComputedStyle 端到端解算
    expect(window.getComputedStyle(document.body).backgroundColor).toMatch(/^rgba\(11, ?14, ?20, ?0\.5\)$/);
    // 关键证据 1:它绝不能等同于纯不透明 rgb(...)
    expect(window.getComputedStyle(document.body).backgroundColor).not.toMatch(/^rgb\(/);
    // 关键证据 2:且包含字面 '0.5' 作为 alpha 通道
    expect(window.getComputedStyle(document.body).backgroundColor).toContain('0.5');
  });

  it('forces body background to opaque rgb(11, 14, 20) and turns off wallpaper when reduceTransparency is true', () => {
    document.head.innerHTML = `<style>:root { --bg-app-rgb: 11, 14, 20; }</style>`;
    setUiPrefs({ surfaceOpacity: 0.5, reduceTransparency: true });
    applyUiPrefs(getUiPrefs());
    // reduceTransparency 强制无 alpha 通道(jsdom 规范化后通道间带空格)
    expect(resolveBodyBackground(getUiPrefs())).toMatch(/^rgb\(11, ?14, ?20\)$/);
    // body 背景也被强覆盖为不透明
    expect(document.body.style.backgroundColor).toMatch(/^rgb\(11, ?14, ?20\)$/);
    expect(window.getComputedStyle(document.body).backgroundColor).toMatch(/^rgb\(11, ?14, ?20\)$/);
    // dataset 已写到 <html> 上触发 cascade 的 !important 覆盖
    expect(document.documentElement.dataset.reduceTransparency).toBe('true');
    // inline 值仍记录用户原始意图 (0.5),cascade 的 !important 由 base.css 接管
    expect(document.documentElement.style.getPropertyValue('--surface-opacity')).toBe('0.5');
  });

  it('returns transparent body when a background image is set, so ::before wallpaper shows through', () => {
    document.head.innerHTML = `<style>:root { --bg-app-rgb: 11, 14, 20; }</style>`;
    setUiPrefs({
      surfaceOpacity: 0.5,
      backgroundImage: 'https://example.com/bg.jpg',
      backgroundImageOpacity: 0.4,
    });
    applyUiPrefs(getUiPrefs());
    expect(resolveBodyBackground(getUiPrefs())).toBe('transparent');
    expect(document.body.style.backgroundColor).toBe('transparent');
  });

  it('derives accent derivatives directly from the rgb join formula', () => {
    applyUiPrefs({
      ...getUiPrefs(),
      accentColor: '#60a5fa',
      surfaceOpacity: 1,
      reduceTransparency: false,
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--accent')).toBe('#60a5fa');
    expect(style.getPropertyValue('--accent-subtle')).toBe('rgba(96, 165, 250, 0.14)');
    expect(style.getPropertyValue('--accent-border')).toBe('rgba(96, 165, 250, 0.38)');
    expect(style.getPropertyValue('--accent-hover')).toBe('#79b3fb');
  });
});
