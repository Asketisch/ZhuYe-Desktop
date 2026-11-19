/**
 * 助手正文分段 —— 把混进正文的"思考过程"和运行时标记拆出来。
 *
 * 三条已知的思考泄漏路径与各自的归属:
 * - Anthropic 原生 thinking 块 / OpenAI 兼容端点的 `reasoning_content`
 *   字段 → 上游已转为 `ThinkingDelta` 事件,走 reducer 的 thinking 条目,
 *   与本模块无关;
 * - `<think>` 系标签混在正文:MiniMax M3 / DeepSeek 系部分端点把推理以
 *   标签形式写进 content —— 本模块负责拆分;
 * - **无标签纯文本泄漏**:模型把推理直接当正文输出,没有任何边界标记,
 *   原理上无法与正文区分 —— 不处理(那是模型/端点侧的问题)。
 *
 * 另剥离 `FINAL ANSWER:` 运行时标记:nudge / auto-continue 边路会注入
 * `reflect_prompt::FINAL_ANSWER_TEMPLATE`,模型会照字面回显到答案里
 * (常驻注入已从系统提示词移除,但历史会话与边路注入仍会产生)。
 *
 * 在渲染层拆分(而非 reducer 层),streaming 增量、agent_message 定稿、
 * 会话回放三条路径统一生效;正文数据保持原样,不丢信息。
 */

export interface AssistantSegments {
  /** 思考过程文本(无则为 null)。 */
  thinking: string | null;
  /** 去除思考块与 FINAL ANSWER 标记后的可见正文。 */
  content: string;
}

/**
 * 思考开标签:必须**独占行首**(容忍行首空白)才算 —— 避免把行文中的
 * `<think>` 字样(文档、内联代码)误判成分段点。别名覆盖常见推理模型:
 * DeepSeek/Qwen/MiniMax 用 `<think>`,个别模型用 thinking/thought/reasoning。
 */
const OPEN_TAG_RE = /^[ \t]*<(think|thinking|thought|reasoning)>/i;
/** 代码围栏(``` / ~~~)内的 `<think>` 字样是代码内容,不是分段点。 */
const FENCE_RE = /^[ \t]*(?:```|~~~)/;
const TAG_ALIASES = ['think', 'thinking', 'thought', 'reasoning'] as const;

/** 行首标记(容忍 `> ` / `**` / 列表符等 markdown 修饰);只删标记本身,保留行内余文。 */
const FINAL_ANSWER_MARKER = /^[ \t>*-]*\*{0,2}FINAL ANSWER\*{0,2}[:：][ \t]*/gm;
/** 模型照字面回显模板时,<answer> 占位符会单独成行 —— 一并移除。 */
const TEMPLATE_PLACEHOLDER_LINE = /^[ \t>*-]*<answer>[ \t]*$/gm;

export function splitAssistantText(raw: string): AssistantSegments {
  const open = findThinkOpen(raw);
  if (!open) {
    return { thinking: null, content: stripRuntimeMarkers(raw) };
  }

  const afterOpen = raw.slice(open.contentStart);
  const close = findThinkClose(afterOpen, open.alias);
  if (close === null) {
    // 流式中标签未闭合:标签之后全部是推理,正文为空。
    return {
      thinking: stripRuntimeMarkers(afterOpen).trim() || null,
      content: '',
    };
  }

  const before = raw.slice(0, open.tagLineStart);
  const inner = afterOpen.slice(0, close.index);
  const rest = afterOpen.slice(close.index + close.lengthOf);
  return {
    thinking: stripRuntimeMarkers(`${before}${inner}`).trim() || null,
    content: stripRuntimeMarkers(rest).replace(/^\s+/, ''),
  };
}

interface ThinkOpen {
  /** 开标签所在行的行首偏移(行首之前的正文折叠进 thinking)。 */
  tagLineStart: number;
  /** 开标签 `>` 之后的第一个字符偏移(思考文本从这里开始)。 */
  contentStart: number;
  alias: string;
}

/** 逐行扫描第一个**代码围栏外**、行首的开标签;找不到返回 null。 */
function findThinkOpen(text: string): ThinkOpen | null {
  let offset = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = OPEN_TAG_RE.exec(line);
      if (m) {
        return {
          tagLineStart: offset,
          contentStart: offset + m.index + m[0].length,
          alias: m[1].toLowerCase(),
        };
      }
    }
    offset += line.length + 1;
  }
  return null;
}

/** 在开标签之后找闭合标签:优先同名别名,否则任一别名取最早出现者。 */
function findThinkClose(text: string, alias: string): { index: number; lengthOf: number } | null {
  const ordered = [
    ...closeMatches(text, alias),
    ...TAG_ALIASES.filter((a) => a !== alias).flatMap((a) => closeMatches(text, a)),
  ].sort((a, b) => a.index - b.index);
  return ordered[0] ?? null;
}

function closeMatches(text: string, alias: string): Array<{ index: number; lengthOf: number }> {
  const re = new RegExp(`</${alias}>`, 'gi');
  const out: Array<{ index: number; lengthOf: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ index: m.index, lengthOf: m[0].length });
  }
  return out;
}

function stripRuntimeMarkers(text: string): string {
  return text
    .replace(FINAL_ANSWER_MARKER, '')
    .replace(TEMPLATE_PLACEHOLDER_LINE, '')
    .replace(/\n{3,}/g, '\n\n');
}
