/**
 * Markdown 渲染 —— react-markdown + remark-gfm + remark-math/rehype-katex
 * + prismjs + CSS Modules。
 *
 * - 代码块:复制按钮 + 深色主题 + 常用语言静态高亮(别名表归一);
 * - `mermaid` 代码块交给 MermaidDiagram 按需渲染(图表/代码切换);
 * - LaTeX 公式:`$..$` 行内 / `$$..$$` 块级,KaTeX 渲染(流式中未闭合的
 *   公式按原文显示,写完后成式);
 * - 图片:token 化样式 + 点击 Lightbox 放大(B4)。
 */
import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import Prism from 'prismjs';
// 常用语言静态注册(核心自带 markup/css/clike/javascript);
// 依赖顺序:jsx 依赖 markup+javascript,tsx 依赖 jsx —— 顺序不可乱。
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-csharp.js';
// php 依赖 markup-templating(模板语法插入),必须先注册。
import 'prismjs/components/prism-markup-templating.js';
import 'prismjs/components/prism-php.js';
import 'prismjs/components/prism-ruby.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-toml.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-diff.js';
import 'prismjs/components/prism-docker.js';
import 'prismjs/components/prism-graphql.js';
import 'prismjs/components/prism-kotlin.js';
import 'prismjs/components/prism-swift.js';
import 'prismjs/components/prism-lua.js';
import 'prismjs/components/prism-markdown.js';
import { Check, Copy } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { Lightbox } from './Lightbox';
import { MermaidDiagram } from './MermaidDiagram';
import s from './Markdown.module.css';

/** 语言别名归一(大小写不敏感),未命中按原样查 Prism 语法表。 */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  py: 'python',
  golang: 'go',
  'c++': 'cpp',
  cs: 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  dockerfile: 'docker',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
};

function normalizeLang(raw: string): string {
  const lower = raw.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

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

function highlight(code: string, rawLang: string): string | null {
  const lang = normalizeLang(rawLang);
  const g = (Prism.languages as unknown as Record<string, Prism.Grammar>)[lang];
  if (!g) return null;
  return Prism.highlight(code, g, lang);
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

function escapeHtml(str: string): string {
  return str.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
