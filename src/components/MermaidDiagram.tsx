/**
 * MermaidDiagram —— `mermaid` 代码块的按需图表渲染(B2)。
 *
 * - 重依赖(~1MB)懒加载:首个 mermaid 块出现才 `import('mermaid')`;
 * - `securityLevel: 'strict'`(禁 click/label 中的脚本),配色取自 tokens.css
 *   并经 `theme: 'base'` + `themeVariables` 交给 Mermaid(它要在色值上做加深 /
 *   提亮等派生计算,只能吃可解析的 hex,故从 <html> 的计算样式里读),
 *   主题切换后重渲染;
 * - 渲染失败(语法错/流式未写完)回退显示源码,不阻断整条消息;
 * - 「图表/代码」切换查看原文(与 DeepSeek demo 同款交互)。
 *
 * 流式安全:code 变化即重渲染;未完成的图语法大概率 parse 失败 → 回退
 * 源码展示,块写完后自动变为图。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeTheme } from '@/logic/harness/preferences/theme';
import s from './MermaidDiagram.module.css';

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidSeq = 0;

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/**
 * 图表配色 = tokens.css 的角色映射,配 `theme: 'base'` 使用(见下方 initialize)。
 * - 只取 hex 形态的 token(color-mix 派生量 Mermaid 解析不了);读不到的键剔除,
 *   交给 base 主题的内置默认值兜底。
 * - 饼图扇区走 pie1..N 这组键。
 */
export function mermaidThemeVariables(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const computed = getComputedStyle(document.documentElement);
  const token = (name: string): string | undefined => computed.getPropertyValue(name).trim() || undefined;
  const fg = token('--fg');
  const fgSubtle = token('--fg-2');
  const fgFaint = token('--fg-3');
  const line = token('--line');
  const lineStrong = token('--line-2');
  const panel = token('--surface-2');
  const entries: Array<[string, string | undefined]> = [
    ['background', token('--bg')],
    ['primaryColor', panel],
    ['primaryTextColor', fg],
    ['primaryBorderColor', lineStrong],
    ['secondaryColor', token('--surface-3')],
    ['secondaryTextColor', fg],
    ['secondaryBorderColor', lineStrong],
    ['tertiaryColor', token('--fill-2')],
    ['tertiaryTextColor', fg],
    ['tertiaryBorderColor', lineStrong],
    ['lineColor', fgFaint],
    ['textColor', fgSubtle],
    ['titleColor', fg],
    ['noteBkgColor', token('--surface-3')],
    ['noteTextColor', fgSubtle],
    ['noteBorderColor', lineStrong],
    ['actorBkg', panel],
    ['actorBorder', lineStrong],
    ['actorTextColor', fg],
    ['actorLineColor', fgFaint],
    ['labelColor', fgSubtle],
    ['labelTextColor', fgSubtle],
    ['labelBackgroundColor', token('--bg')],
    ['labelBorderColor', lineStrong],
    ['edgeLabelBackground', token('--bg')],
    ['clusterBkg', token('--bg')],
    ['clusterBorder', line],
  ];
  const variables: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value) variables[key] = value;
  }
  // 饼图扇区色:琥珀 / 鼠尾草绿 / 暗金 / 砖红,再补两档中性灰凑满六色。
  // Mermaid 只认 pie1..N 这组键(cScale 实测不生效)。
  const scale = [token('--accent'), token('--ok'), token('--warn'), token('--danger'), token('--fg-3'), token('--accent-line')]
    .filter((value): value is string => Boolean(value));
  scale.forEach((value, index) => { variables[`pie${index + 1}`] = value; });
  // 扇区文字用「实心块上的文字」:暗色下扇区是浅琥珀、配深墨字,亮色下扇区是深琥珀棕、
  // 配米白字,两边都有对比(沿用 textColor 会发虚)。
  const onSolid = token('--on-white');
  if (onSolid) variables.pieSectionTextColor = onSolid;
  if (fg) variables.pieTitleTextColor = fg;
  return variables;
}

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const idRef = useRef(`zhuye-mermaid-${++mermaidSeq}`);
  // 每次渲染用独立 id：mermaid.render 会先把文档里同 id 的旧 SVG 删掉再出图，
  // 复用 id 会让旧图在重渲染期间从页面上消失（主题切换 / 流式更新时闪烁）。
  const renderSeq = useRef(0);

  const render = useCallback(async (next: string) => {
    try {
      const mermaid = await loadMermaid();
      // 主题是全局配置 —— 每次渲染前按当前 token 重设(可重复调用,合并配置)。
      // 必须用 base 主题:实测这一版 Mermaid 只有在 base 下才采纳 themeVariables,
      // 配内置的 default / dark 主题时它们会被直接忽略。
      mermaid.initialize({ theme: 'base', themeVariables: mermaidThemeVariables() });
      const { svg: out } = await mermaid.render(`${idRef.current}-${++renderSeq.current}`, next);
      setSvg(out);
      setError(null);
    } catch (e) {
      // 流式未写完 / 语法错误:回退源码,不清空已渲染成功的旧图之外的态。
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void render(code);
  }, [code, render]);

  // 已渲染的图不会自己跟随明暗:主题变化(含跟随系统)时按新 token 重渲染。
  useEffect(() => subscribeTheme(() => { void render(code); }), [code, render]);

  return (
    <div className={s.wrap} data-testid="mermaid-diagram">
      <div className={s.header}>
        <span className={s.lang}>mermaid</span>
        <button
          type="button"
          className={s.toggle}
          onClick={() => setShowCode((v) => !v)}
          data-testid="mermaid-toggle"
        >
          {showCode ? '图表' : '代码'}
        </button>
      </div>
      {svg && !showCode ? (
        // mermaid.render 产物是自含 SVG;securityLevel=strict 已剥离脚本。
        <div className={s.svg} dangerouslySetInnerHTML={{ __html: svg }} role="img" />
      ) : (
        <pre className={s.fallback}>
          <code>{code}</code>
          {error && <span className={s.errorHint}>⚠ {error}</span>}
        </pre>
      )}
    </div>
  );
}
