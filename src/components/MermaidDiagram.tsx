/**
 * MermaidDiagram —— `mermaid` 代码块的按需图表渲染(B2)。
 *
 * - 重依赖(~1MB)懒加载:首个 mermaid 块出现才 `import('mermaid')`;
 * - `securityLevel: 'strict'`(禁 click/label 中的脚本),主题跟随应用
 *   `data-theme`(暗色优先,light 才用 default);
 * - 渲染失败(语法错/流式未写完)回退显示源码,不阻断整条消息;
 * - 「图表/代码」切换查看原文(与 DeepSeek demo 同款交互)。
 *
 * 流式安全:code 变化即重渲染;未完成的图语法大概率 parse 失败 → 回退
 * 源码展示,块写完后自动变为图。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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

function currentMermaidTheme(): 'dark' | 'default' {
  // 暗色优先:未设置 / dark → dark;仅 light 用 default。
  return document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
}

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const idRef = useRef(`zhuye-mermaid-${++mermaidSeq}`);

  const render = useCallback(async (next: string) => {
    try {
      const mermaid = await loadMermaid();
      // v11 主题是全局配置 —— 每次渲染前按当前主题重设(可重复调用,合并配置)。
      mermaid.initialize({ theme: currentMermaidTheme() });
      const { svg: out } = await mermaid.render(idRef.current, next);
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
