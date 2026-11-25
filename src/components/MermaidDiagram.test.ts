/**
 * Mermaid 图表配色的映射测试。
 *
 * mermaidThemeVariables 把 tokens.css 的角色 token 映射成 Mermaid 的
 * themeVariables。「必须配 theme: 'base' 才被采纳」这一条依赖真实渲染器，
 * 只能在浏览器里验证；这里钉住映射本身与缺 token 时的降级。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mermaidThemeVariables } from './MermaidDiagram';

const STYLE_ID = 'mermaid-theme-vars-test';

/** 注入一份最小 token 表（jsdom 能从样式表解析出自定义属性）。 */
function installTokens(css: string): void {
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

afterEach(() => {
  document.getElementById(STYLE_ID)?.remove();
  delete document.documentElement.dataset.theme;
});

describe('mermaidThemeVariables', () => {
  it('把设计 token 按角色映射成 Mermaid 主题变量', () => {
    installTokens(`:root {
      --bg: #101011; --surface-2: #202021; --surface-3: #242425; --fill-2: #303031;
      --fg: #e9e8e5; --fg-2: #949391; --fg-3: #676765;
      --line: #2d2d2e; --line-2: #373736;
      --accent: #e8b46b; --accent-line: #5b4630;
      --ok: #9aaa93; --warn: #d1783c; --danger: #b77e78; --on-white: #181613;
    }`);
    const vars = mermaidThemeVariables();
    // 节点：面板底 + 正文色 + 强描边
    expect(vars.primaryColor).toBe('#202021');
    expect(vars.primaryTextColor).toBe('#e9e8e5');
    expect(vars.primaryBorderColor).toBe('#373736');
    // 画布与连线
    expect(vars.background).toBe('#101011');
    expect(vars.lineColor).toBe('#676765');
    expect(vars.clusterBorder).toBe('#2d2d2e');
    // 饼图扇区：琥珀 / 鼠尾草绿 / 暗金 / 砖红；扇区文字取「实心块上的文字」
    expect(vars.pie1).toBe('#e8b46b');
    expect(vars.pie2).toBe('#9aaa93');
    expect(vars.pie3).toBe('#d1783c');
    expect(vars.pie4).toBe('#b77e78');
    expect(vars.pieSectionTextColor).toBe('#181613');
    // cScale 实测不生效，不应再产出这个键
    expect(vars.cScale).toBeUndefined();
    // 全部是可解析的具体色值，没有把 var() 透传给 Mermaid
    expect(Object.values(vars).every((value) => /^#[0-9a-f]{6}$/i.test(value))).toBe(true);
  });

  it('同一份调用跟随当前主题的取值', () => {
    installTokens(`:root { --surface-2: #202021; --fg: #e9e8e5; }
      [data-theme="light"] { --surface-2: #ffffff; --fg: #242321; }`);
    expect(mermaidThemeVariables().primaryColor).toBe('#202021');
    document.documentElement.dataset.theme = 'light';
    expect(mermaidThemeVariables().primaryColor).toBe('#ffffff');
    expect(mermaidThemeVariables().primaryTextColor).toBe('#242321');
  });

  it('读不到的 token 一律剔除，交给 base 主题兜底', () => {
    installTokens(`:root { --fg: #111111; }`);
    const vars = mermaidThemeVariables();
    // 只有纯由 --fg 派生的键保留
    expect(Object.keys(vars).sort()).toEqual(
      ['actorTextColor', 'pieTitleTextColor', 'primaryTextColor', 'secondaryTextColor', 'tertiaryTextColor', 'titleColor'],
    );
    expect(vars.primaryColor).toBeUndefined();
    expect(vars.pie1).toBeUndefined();
    expect(vars.pieSectionTextColor).toBeUndefined();
  });
});
