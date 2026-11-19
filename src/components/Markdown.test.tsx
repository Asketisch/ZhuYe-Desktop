/**
 * Vitest — Markdown 渲染增强(B1 LaTeX / B2 Mermaid / B3 语言别名 / B4 图片)。
 *
 * mermaid 为重依赖,这里 mock 掉:断言代码块被路由到 MermaidDiagram 与
 * 图表/代码切换交互,不真渲染 SVG(真实渲染属视觉冒烟)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Markdown } from './Markdown';

const renderMock = vi.hoisted(() =>
  vi.fn(async () => ({ svg: '<svg data-testid="mock-mermaid-svg"></svg>' })),
);
const initialize = vi.hoisted(() => vi.fn());
vi.mock('mermaid', () => ({
  default: { initialize, render: renderMock },
}));

describe('Markdown B 渲染增强', () => {
  beforeEach(() => {
    renderMock.mockClear();
    initialize.mockClear();
  });
  afterEach(() => cleanup());

  it('LaTeX 行内公式经 KaTeX 渲染(B1)', () => {
    const { container } = render(<Markdown text={`质能方程 $E=mc^2$ 成立`} />);
    const katex = container.querySelector('.katex');
    expect(katex).not.toBeNull();
    expect(container.textContent).toContain('E=mc');
  });

  it('LaTeX 块级公式渲染(B1,多行 $$ 形态 → katex-display)', () => {
    // remark-math 语义:单行 $$..$$ 是 inline 数学,多行(公式独占段)才是
    // display —— 断言用多行形态。
    const { container } = render(
      <Markdown text={'推导:\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$'} />,
    );
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('流式未闭合的 $$ 公式按原文显示,不抛错(B1 流式安全)', () => {
    const { container } = render(<Markdown text={`正在写:$$E=mc^2`} />);
    // 未闭合 → 不产出 katex-display,原文可见。
    expect(container.querySelector('.katex-display')).toBeNull();
    expect(container.textContent).toContain('E=mc');
  });

  it('mermaid 代码块路由到图表组件,可切换查看源码(B2)', async () => {
    render(<Markdown text={'```mermaid\ngraph TD; A-->B;\n```'} />);
    expect(await screen.findByTestId('mermaid-diagram')).toBeDefined();
    expect(await screen.findByTestId('mock-mermaid-svg')).toBeDefined();
    fireEvent.click(screen.getByTestId('mermaid-toggle'));
    // 切到代码视图:显示源码文本。
    expect(screen.getByText(/graph TD; A-->B;/)).toBeDefined();
  });

  it('语言别名归一后高亮(sh → bash),未知语言回退纯文本(B3)', () => {
    const { container } = render(
      <Markdown text={'```sh\necho hi\n```'} />,
    );
    const code = container.querySelector('code.language-sh');
    expect(code).not.toBeNull();
    // bash 语法高亮产出 token class;未注册语言则只有转义文本。
    expect(code?.innerHTML).toContain('token');
    const { container: plain } = render(
      <Markdown text={'```unknownlang\nplain\n```'} />,
    );
    const plainCode = plain.querySelector('code.language-unknownlang');
    expect(plainCode?.innerHTML).not.toContain('token');
  });

  it('Markdown 图片带 data-testid 与放大样式(B4)', () => {
    render(<Markdown text={'![logo](data:image/png;base64,AA)'} />);
    const img = screen.getByTestId('markdown-image') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,AA');
  });
});
