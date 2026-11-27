/**
 * Vitest — ThinkingCollapsible（思考折叠块,ZCode Reasoning 同款显示方案）。
 *
 * 验证:
 * 1. 折叠摘要:流式「thinking」、已结束带打点「thought lasted Ns」、
 *    无打点回退「a few seconds」、summary 变体专属标签;
 * 2. 默认折叠,点击展开正文,再点收起;
 * 3. 展开正文在限高滚动容器内（thinking-scroll testid）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThinkingCollapsible } from './ThinkingCollapsible';

afterEach(cleanup);

function openRow() {
  // 思考行 = Collapsible 头部按钮（info/success accent 档）。
  const row = document.querySelector('[data-accent="info"] > button, [data-accent="success"] > button') as HTMLButtonElement | null;
  if (!row) throw new Error('思考行头部未渲染');
  return row;
}

describe('ThinkingCollapsible', () => {
  it('流式中标签为 thinking(扫光),默认折叠不渲染正文', () => {
    render(<ThinkingCollapsible text="still reasoning" streaming />);
    expect(screen.getByText('thinking')).toBeDefined();
    expect(screen.queryByTestId('thinking-scroll')).toBeNull();
  });

  it('已结束且带打点:标签显示思考时长(向上取整,至少 1s)', () => {
    render(
      <ThinkingCollapsible
        text="done reasoning"
        startedAt={1_000}
        endedAt={5_400}
      />,
    );
    expect(screen.getByText('thought lasted 5s')).toBeDefined();
  });

  it('无打点(回放 / <think> 合成条目):回退持续了几秒', () => {
    render(<ThinkingCollapsible text="replayed reasoning" />);
    expect(screen.getByText('thought lasted a few seconds')).toBeDefined();
  });

  it('summary 变体:专属标签推理摘要 + success 档', () => {
    render(<ThinkingCollapsible text="summary text" summaryLabel />);
    expect(screen.getByText('reasoning summary')).toBeDefined();
    expect(document.querySelector('[data-accent="success"]')).not.toBeNull();
  });

  it('点击展开正文(限高滚动容器),再点收起', () => {
    render(<ThinkingCollapsible text="some long reasoning text" />);
    expect(screen.queryByTestId('thinking-scroll')).toBeNull();
    fireEvent.click(openRow());
    expect(screen.getByTestId('thinking-scroll')).not.toBeNull();
    expect(screen.getByTestId('thinking-scroll').textContent).toContain('some long reasoning text');
    fireEvent.click(openRow());
    expect(screen.queryByTestId('thinking-scroll')).toBeNull();
  });

  it('活动组单行态:compact 去卡片边距(挂 thinkingCompact 包装)', () => {
    const { container } = render(<ThinkingCollapsible text="x" compact />);
    expect(container.firstElementChild?.className).not.toBe('');
  });
});
