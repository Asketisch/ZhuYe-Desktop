/**
 * Markdown 渲染 —— react-markdown + remark-gfm + remark-math/rehype-katex
 * + prismjs + CSS Modules。
 *
 * - 代码块:复制按钮 + 深色主题 + 常用语言静态高亮(别名表归一);
 * - `mermaid` 代码块交给 MermaidDiagram 按需渲染(图表/代码切换);
 * - LaTeX 公式:`$..$` 行内 / `$$..$$` 块级,KaTeX 渲染(流式中未闭合的
 *   公式按原文显示,写完后成式);
 * - 图片:token 化样式 + 点击 Lightbox 放大(B4)。
 *
 * Prism 语言注册与高亮管线在 `./highlight.ts`(文件预览 / diff 行内
 * 高亮等场景共用同一份语言表)。
 */
import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Check, Copy } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { Lightbox } from './Lightbox';
import { MermaidDiagram } from './MermaidDiagram';
import { normalizeLang, highlight, escapeHtml } from './highlight';
import s from './Markdown.module.css';

/**
 * URL 净化:react-markdown 默认 urlTransform 会清空 `data:` URL,把内联
 * base64 图片(引擎 Image 块/模型输出)整个吞掉 —— 这里放行 `data:image/`
 * 前缀,其余沿用默认白名单(http(s)/mailto/相对路径),仍拦 `javascript:`。
 */
function safeUrlTransform(url: string): string {
  if (url.startsWith('data:image/')) return url;
  if (url === '') return '';
  try {
    const parsed = new URL(url, 'https://zhuye.invalid');
    // 相对路径(parsed.host 为占位 host)与 http(s)/mailto 放行。
    if (parsed.host === 'zhuye.invalid' || /^https?:$/.test(parsed.protocol) || parsed.protocol === 'mailto:') {
      return url;
    }
    return '';
  } catch {
    return '';
  }
}

interface Props {
  text: string;
}

export function Markdown({ text }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className={s.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={safeUrlTransform}
        components={{
          code({ inline, className, children }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          }) {
            const code = String(children ?? '').replace(/\n$/, '');
            const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
            if (inline || !lang) {
              return <code className={s.inlineCode}>{code}</code>;
            }
            if (normalizeLang(lang) === 'mermaid') {
              return <MermaidDiagram code={code} />;
            }
            return <CodeBlock code={code} lang={lang} />;
          },
          img({ src, alt }) {
            const url = typeof src === 'string' ? src : '';
            if (!url) return null;
            return (
              <img
                src={url}
                alt={alt ?? ''}
                className={s.image}
                loading="lazy"
                onClick={() => setPreview(url)}
                data-testid="markdown-image"
              />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
      <Lightbox src={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const html = highlight(code, lang);

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div className={s.codeWrap}>
      <div className={s.codeHeader}>
        <span className={s.codeLang}>{lang}</span>
        <button onClick={onCopy} className={s.copyBtn} title="Copy code">
          <Icon icon={copied ? Check : Copy} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={s.pre}>
        <code
          className={`language-${lang}`}
          dangerouslySetInnerHTML={{ __html: html ?? escapeHtml(code) }}
        />
      </pre>
    </div>
  );
}
