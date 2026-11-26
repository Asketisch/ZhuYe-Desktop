/**
 * Vitest — SlashPopup 测试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SlashPopup } from '@/features/input/composer/SlashPopup';
import { setPluginSlashCommands } from '@/logic/input/composer/slashCommands';

afterEach(() => {
  // 插件命令注册表是模块级状态,用例后复位。
  setPluginSlashCommands([]);
});

describe('SlashPopup', () => {
  it('returns null when not visible', () => {
    const { container } = render(
      <SlashPopup query="" onSelect={vi.fn()} visible={false} activeIdx={0} onActiveIdxChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no matches', () => {
    const { container } = render(
      <SlashPopup query="zzzzzz" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists all commands when query is empty', () => {
    const { container } = render(<SlashPopup query="" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    expect(container.textContent).toContain('/effort');
    expect(container.textContent).toContain('/compact');
  });

  it('filters by name prefix', () => {
    const { container } = render(<SlashPopup query="eff" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    expect(container.textContent).toContain('/effort');
    expect(container.textContent).not.toContain('/compact');
  });

  it('filters by alias prefix', () => {
    const { container } = render(<SlashPopup query="?" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    // "?" 是 "help" 的别名
    expect(container.textContent).toContain('/help');
  });

  it('calls onSelect when command clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(<SlashPopup query="eff" onSelect={onSelect} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    const btn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('/effort'),
    );
    expect(btn).toBeDefined();
    btn!.click();
    expect(onSelect).toHaveBeenCalledWith('effort');
  });

  it('updates active index on mouse enter (no throw)', () => {
    const { container } = render(<SlashPopup query="" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons[3]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });

  it('renders plugin commands with their real description (not i18n)', () => {
    setPluginSlashCommands([{ name: 'demo:hello', description: 'say hi to someone' }]);
    const { container } = render(<SlashPopup query="demo" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    expect(container.textContent).toContain('/demo:hello');
    expect(container.textContent).toContain('say hi to someone');
  });

  it('plugin command with null description renders without crashing', () => {
    setPluginSlashCommands([{ name: 'demo:quiet', description: null }]);
    // 前缀匹配按命令全名 —— `demo:q` 命中 `demo:quiet`。
    const { container } = render(<SlashPopup query="demo:q" onSelect={vi.fn()} visible={true} activeIdx={0} onActiveIdxChange={vi.fn()} />);
    expect(container.textContent).toContain('/demo:quiet');
  });
});