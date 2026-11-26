/**
 * Tooltip primitive — 渲染契约测试。
 *
 * 重点验证 `multiline` prop(为 StatusBar 的 `\n`-joined label 引入):
 *   - 默认不开 `data-multiline`(保持单行 nowrap 行为不变)
 *   - 开了 multiline 时,tip 元素带 `data-multiline="true"`,CSS 切到 pre-line
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders label and children', () => {
    const { getByRole, getByText } = render(
      <Tooltip label="hi">trigger</Tooltip>,
    );
    expect(getByText('trigger')).toBeTruthy();
    expect(getByRole('tooltip').textContent).toBe('hi');
  });

  it('omits data-multiline by default (single-line nowrap behavior)', () => {
    const { getByRole } = render(<Tooltip label="hi">x</Tooltip>);
    const tip = getByRole('tooltip');
    expect(tip.getAttribute('data-multiline')).toBeNull();
  });

  it('sets data-multiline="true" when multiline prop is on', () => {
    const { getByRole } = render(
      <Tooltip label="a\nb\nc" multiline>
        x
      </Tooltip>,
    );
    const tip = getByRole('tooltip');
    expect(tip.getAttribute('data-multiline')).toBe('true');
  });
});
