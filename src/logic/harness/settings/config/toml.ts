/**
 * 复杂分区、feature flags 和未知分区检测的纯 TOML 辅助函数。
 * 这些函数纯粹操作 TOML 字符串，
 * 因此可以在不依赖 React 的聚焦单元测试中直接使用。
 *
 * 语义（自 ConfigForm.tsx 保留）：
 *  - 未知顶层分区通过 `findUnknownSections` 暴露，
 *    以便 UI 提示用户使用高级 TOML 编辑器
 *  - 子分区编辑保持其他分区内的未知键不变
 *  - feature flags 以 `flags = { ... }` 内联表形式存储
 *  - `[context_windows]` 段的最大上下文读写
 */

import { applyField } from './schema';

export interface SubSectionEntry {
  name: string;
  body: string;
}

export interface FlagEntry {
  key: string;
  value: boolean;
}

/** 提取给定前缀下的所有子分区条目（如 `mcp_servers`）。 */
export function extractSubSections(toml: string, prefix: string): SubSectionEntry[] {
  const lines = toml.split('\n');
  const out: SubSectionEntry[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const sec = /^\[([^\]]+)\]/.exec(line);
    if (sec) {
      if (current) out.push({ name: current.name, body: current.lines.join('\n').trim() });
      const full = sec[1].trim();
      if (full === prefix) current = { name: '(default)', lines: [] };
      else if (full.startsWith(`${prefix}.`)) current = { name: full.slice(prefix.length + 1), lines: [] };
      else current = null;
    } else if (current) {
      current.lines.push(raw);
    }
  }
  if (current) out.push({ name: current.name, body: current.lines.join('\n').trim() });
  return out.filter((e) => e.body.length > 0);
}

/** 替换子分区内容（当名称为 `(default)` 时替换裸 `[prefix]` 分区）。 */
export function updateSubSection(toml: string, prefix: string, name: string, body: string): string {
  if (name === '(default)') return setSectionBody(toml, `[${prefix}]`, body);
  return setSectionBody(toml, `[${prefix}.${name}]`, body);
}

/** 按名称移除子分区。 */
export function removeSubSection(toml: string, prefix: string, name: string): string {
  const target = name === '(default)' ? `[${prefix}]` : `[${prefix}.${name}]`;
  return removeSection(toml, target);
}

/** 若不存在则追加一个新的子分区。 */
export function addSubSection(toml: string, prefix: string, name: string): string {
  const header = name.includes('.') ? `[${prefix}.${name}]` : `[${prefix}]`;
  if (toml.includes(header)) return toml;
  return `${toml.replace(/\s*$/, '')}\n\n${header}\n# TODO: edit me\n`;
}

/** 将用户输入的 key 转义后用于 RegExp（防 `(`、`[` 等字符抛 SyntaxError）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 替换表头下的内容行。如果表头不存在则追加。
 * 未知行（如其他分区）保持不变。
 */
export function setSectionBody(toml: string, header: string, body: string): string {
  const lines = toml.split('\n');
  const out: string[] = [];
  let replaced = false;
  let inTarget = false;
  let blockLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === header) {
      if (inTarget) {
        out.push(...blockLines);
      }
      out.push(header);
      out.push(body.trimEnd());
      out.push('');
      inTarget = true;
      blockLines = [];
      replaced = true;
      continue;
    }
    if (inTarget) {
      if (/^\[/.test(line.trim())) {
        out.push(...blockLines);
        inTarget = false;
        blockLines = [];
      } else {
        blockLines.push(line);
        continue;
      }
    }
    out.push(line);
  }
  if (inTarget) out.push(...blockLines);
  if (!replaced) {
    out.push('');
    out.push(header);
    out.push(body.trimEnd());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 从 TOML 中剥离单个表头及其内容。 */
export function removeSection(toml: string, header: string): string {
  const lines = toml.split('\n');
  const out: string[] = [];
  let inTarget = false;
  for (const line of lines) {
    if (line.trim() === header) {
      inTarget = true;
      continue;
    }
    if (inTarget) {
      if (/^\[/.test(line.trim())) inTarget = false;
      else continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 读取 `[feature_flags]` 中声明的全部布尔开关。 */
export function extractFlags(toml: string): FlagEntry[] {
  const lines = toml.split('\n');
  let inSection = false;
  const out: FlagEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const sec = /^\[([^\]]+)\]/.exec(line);
    if (sec) {
      inSection = sec[1].trim() === 'feature_flags';
      continue;
    }
    if (!inSection) continue;
    const flagsMatch = /^flags\s*=\s*\{(.+)\}$/.exec(line);
    if (flagsMatch) {
      const pairs = flagsMatch[1].split(',');
      for (const pair of pairs) {
        const kv = /^"?([\w.-]+)"?\s*=\s*(true|false)/.exec(pair.trim());
        if (kv) out.push({ key: kv[1], value: kv[2] === 'true' });
      }
    } else {
      const inline = /^"?([\w.-]+)"?\s*=\s*(true|false)/.exec(line);
      if (inline) out.push({ key: inline[1], value: inline[2] === 'true' });
    }
  }
  return out;
}

/** 将单个功能开关设为给定布尔值，必要时创建分区。 */
export function setFlag(toml: string, key: string, value: boolean): string {
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const sec = /^\[([^\]]+)\]/.exec(lines[i].trim());
    if (sec) {
      if (start !== -1 && end === lines.length) end = i;
      if (sec[1].trim() === 'feature_flags' && start === -1) start = i;
    }
  }
  if (start === -1) {
    return `${toml.replace(/\s*$/, '')}\n\n[feature_flags]\nflags = { "${key}" = ${value} }\n`;
  }
  const body = lines.slice(start + 1, end);
  const flagsLine = body.find((l) => /^flags\s*=/.test(l.trim()));
  if (!flagsLine) {
    body.push(`flags = { "${key}" = ${value} }`);
    lines.splice(end, 0, ...body);
    return lines.join('\n');
  }
  const idx = body.indexOf(flagsLine);
  const inline = /\{(.+)\}/.exec(flagsLine);
  if (!inline) return toml;
  const entries = inline[1]
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const filtered = entries.filter((p) => !new RegExp(`^"?${escapeRegExp(key)}"?\\s*=`).test(p));
  filtered.push(`"${key}" = ${value}`);
  body[idx] = `flags = { ${filtered.join(', ')} }`;
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join('\n');
}

/** 新增功能开关（默认为 true）。 */
export function addFlag(toml: string, key: string): string {
  return setFlag(toml, key, true);
}

/** 从 `[feature_flags]` 移除功能开关（分区不存在时不执行任何操作）。 */
export function removeFlag(toml: string, key: string): string {
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const sec = /^\[([^\]]+)\]/.exec(lines[i].trim());
    if (sec) {
      if (start !== -1 && end === lines.length) end = i;
      if (sec[1].trim() === 'feature_flags' && start === -1) start = i;
    }
  }
  if (start === -1) return toml;
  const body = lines.slice(start + 1, end);
  const updated = body.filter(
    (l) => !new RegExp(`"?${escapeRegExp(key)}"?\\s*=\\s*(true|false)`).test(l.trim()),
  );
  return [...lines.slice(0, start + 1), ...updated, ...lines.slice(end)].join('\n');
}

/**
 * 返回未在已知结构化 schema 中声明的 `[section]` 键列表
 * （供 `ConfigForm` 提示用户）。
 */
export function findUnknownSections(toml: string, knownTopLevel: Set<string>): string[] {
  const sections = new Set<string>();
  for (const line of toml.split('\n')) {
    const sec = /^\[([^\]]+)\]/.exec(line.trim());
    if (!sec) continue;
    const key = sec[1].trim();
    const top = key.split('.')[0];
    if (!knownTopLevel.has(key) && !knownTopLevel.has(top)) sections.add(key);
  }
  return Array.from(sections);
}

// ====== 最大上下文（[context_windows] 段，运行时官方机制） ======
//
// 「某模型的最大上下文」落在 config.toml 的 `[context_windows]` 段
// （key = 模型名）。该段被 runtime 消费：`session_configured` 的
// `context_window_size` 由此级联（优先级高于内置静态表），进而驱动
// Inspector 上下文仪表与 `get_context_remaining` 工具；前端的自动压缩
// （`stores/agent/autoCompact.ts`）也以此为阈值来源。
//
// 归属说明：这两个函数此前住在 `plans.ts`（编码套餐层）—— 该层已随
// 「提供商方案」一起移除，但 `[context_windows]` 与模型组/套餐无关，
// 故迁到本文件（纯 TOML 辅助层）继续对外提供。

/** `[context_windows]` 段中读取 model 对应的窗口 token 数（未设置为 ''）。 */
export function readContextWindowForModel(toml: string, model: string): string {
  if (!model.trim()) return '';
  const escaped = model.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // key 可能以 bare 或 "quoted" 形式写入,两种都认。
  const re = new RegExp(`^"?${escaped}"?\\s*=\\s*(\\d+)`);
  let inSection = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (/^\[([^\]]+)\]$/.test(line)) {
      inSection = line === '[context_windows]';
      continue;
    }
    if (!inSection) continue;
    const m = re.exec(line);
    if (m) return m[1];
  }
  return '';
}

/** 写入/清除 model 的最大上下文（tokens 为空串 = 删除该 key）。 */
export function setContextWindowForModel(toml: string, model: string, tokens: string): string {
  const trimmed = model.trim();
  if (!trimmed) return toml;
  // 手写的既有键可能是 bare 形式（readContextWindowForModel 两种都认），
  // 而 setSectionKey 只按写入形式（quoted）查找 —— 先把两种形式都删掉
  // 再写入，否则 bare 残留 + quoted 追加构成 TOML duplicate key
  //（`m` 与 `"m"` 同键），整份配置会被后端 load_from_str 拒绝。
  let next = applyField(toml, 'context_windows', `"${trimmed}"`, '', 'integer');
  next = applyField(next, 'context_windows', trimmed, '', 'integer');
  if (!tokens.trim()) return next; // 空值 = 仅清除
  return applyField(next, 'context_windows', `"${trimmed}"`, tokens, 'integer');
}