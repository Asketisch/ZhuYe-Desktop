/**
 * 共享 Prism 高亮管线 —— 从 Markdown.tsx 抽出,供聊天代码块之外的
 * 场景复用(文件预览 / diff 行内高亮)。
 *
 * 同步 `Prism.highlight()`,无 worker、无按需加载;未注册语言返回 null,
 * 调用方自行走 escapeHtml 兜底。
 */
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

/** 扩展名 → Prism 语言(文件预览按路径推断语言用)。 */
const EXT_LANG: Record<string, string> = {
  rs: 'rust',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  pyi: 'python',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  json: 'json',
  jsonc: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  lua: 'lua',
  md: 'markdown',
  markdown: 'markdown',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  css: 'css',
  scss: 'css',
  less: 'css',
  dockerfile: 'docker',
  graphql: 'graphql',
  gql: 'graphql',
  patch: 'diff',
  diff: 'diff',
};

export function normalizeLang(raw: string): string {
  const lower = raw.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

/** 按文件路径推断 Prism 语言(无注册语法的扩展名返回 null)。 */
export function langFromPath(path: string): string | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
  const lang = EXT_LANG[ext] ?? LANG_ALIASES[ext];
  if (!lang) return null;
  return (Prism.languages as unknown as Record<string, Prism.Grammar>)[lang] ? lang : null;
}

/**
 * Prism 同步高亮,返回 HTML;语言未注册返回 null(调用方走 escapeHtml)。
 */
export function highlight(code: string, rawLang: string): string | null {
  const lang = normalizeLang(rawLang);
  const g = (Prism.languages as unknown as Record<string, Prism.Grammar>)[lang];
  if (!g) return null;
  return Prism.highlight(code, g, lang);
}

/** 高亮兜底:纯文本转义(与 highlight 的 null 分支配套)。 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
