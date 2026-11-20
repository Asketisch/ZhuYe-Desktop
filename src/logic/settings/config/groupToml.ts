/**
 * 模型组（[[model_group]]）的 TOML 文本手术底层工具。
 *
 * 与 `groups.ts`（对外 API 层）分离：本文件只做**行级**解析与拼装，
 * 不认识「模型组」的业务语义之外的任何东西 —— 组块的增删改由上层
 * 调用方（`groups.ts`）用这些原语组合出来。
 *
 * 键名兼容：读入时认旧键 `[[provider_group]]` / `[[provider_group.credentials]]`，
 * 写入时一律用新键 `[[model_group]]` / `[[model_group.credentials]]`。
 */

/** 表头（`[[array.table]]` / `[table]`）。 */
export interface TableHeader {
  kind: 'array' | 'table';
  name: string;
}

/** 行区间（start 含 / end 不含）。 */
export interface BlockSpan {
  start: number;
  end: number;
}

/** 解析表头：`[[model_group]]` / `[context_windows]`。 */
export function parseHeader(line: string): TableHeader | null {
  const array = /^\[\[([^\]]+)\]\]$/.exec(line);
  if (array) return { kind: 'array', name: array[1].trim() };
  const table = /^\[([^\]]+)\]$/.exec(line);
  if (table) return { kind: 'table', name: table[1].trim() };
  return null;
}

/** 组数组表前缀（新键 + 旧键兼容读入）。 */
export function isGroupPrefix(name: string): boolean {
  return name === 'model_group' || name === 'provider_group';
}

/** 去掉 TOML 字符串字面量的引号（单双引号都认）。 */
export function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** 解析整数字段（u64 / u32 / i64）；非数字 → null（未设置）。 */
export function toInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/** 解析浮点字段（f32 温度）。 */
export function toFloat(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** TOML 字符串字面量（后端字段一律 String，数字形字符串裸写会被
 * serde 以 "expected String, found integer" 拒绝）。 */
export function encode(value: string): string {
  return JSON.stringify(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从行数组里读组块的 `id` kv（只认带引号形式 —— 渲染恒为带引号，
 * 裸 `id = foo` 不是合法 TOML 字符串）。 */
export function readBlockId(line: string): string {
  const kv = /^id\s*=\s*(["'])(.*?)\1/.exec(line.trim());
  return kv ? kv[2] : '';
}

/** 从 `start`（组表头行）起扫该组的归属结束行下标
 * （下一个非本组表头或 EOF）。 */
export function groupOwnedEnd(lines: string[], start: number): number {
  const header = parseHeader(lines[start].trim());
  const prefix = header?.name ?? '';
  for (let i = start + 1; i < lines.length; i++) {
    const h = parseHeader(lines[i].trim());
    if (!h) continue;
    if (isGroupPrefix(h.name) || h.name.startsWith(`${prefix}.credentials`)) continue;
    return i;
  }
  return lines.length;
}

/** 定位 `id` 匹配组的**全部归属行**（含嵌套 credentials 子表）。 */
export function findGroupOwnedSpan(toml: string, id: string): BlockSpan | null {
  const lines = toml.split('\n');
  let start = -1;
  let prefix = '';
  let blockId = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const header = parseHeader(line);
    if (!header) {
      // 组自身 kv 段里的 id 也要读出来（凭据段没有 id 字段）。
      if (start !== -1) {
        const kvId = readBlockId(line);
        if (kvId) blockId = kvId;
      }
      continue;
    }
    if (start !== -1) {
      if (isGroupPrefix(header.name)) {
        // 下一个组条目 —— 前一组在此收尾。
        if (blockId === id) return { start, end: i };
        start = i;
        prefix = header.name;
        blockId = '';
        continue;
      }
      // 嵌套 credentials / quota 子表仍归属当前组。
      if (header.name.startsWith(`${prefix}.credentials`)) continue;
      // 其它表头 = 当前组已结束。
      if (blockId === id) return { start, end: i };
      start = -1;
      prefix = '';
      blockId = '';
      continue;
    }
    if (isGroupPrefix(header.name)) {
      start = i;
      prefix = header.name;
      blockId = '';
    }
  }
  return start !== -1 && blockId === id ? { start, end: lines.length } : null;
}

/** 用新块替换 `[start, end)` 行区间。 */
export function replaceSpan(toml: string, start: number, end: number, block: string[]): string {
  const lines = toml.split('\n');
  lines.splice(start, end - start, ...block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 读 `[active].<key>`（字符串值，已去引号）。 */
export function readActiveKey(toml: string, key: string): string {
  const lines = toml.split('\n');
  let inActive = false;
  for (const raw of lines) {
    const line = raw.trim();
    const header = parseHeader(line);
    if (header) {
      inActive = header.kind === 'table' && header.name === 'active';
      continue;
    }
    if (!inActive) continue;
    const kv = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.+)$`).exec(line);
    if (!kv) continue;
    return stripQuotes(kv[1].trim());
  }
  return '';
}

/** 写 `[active].<key>` = 字符串字面量（始终加引号 —— 组 id 可能是纯数字，
 * 裸写会被后端 serde 以 "expected String, found integer" 拒绝）。 */
export function setActiveKey(toml: string, key: string, value: string): string {
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (!header) continue;
    if (start !== -1 && end === lines.length) end = i;
    if (header.kind === 'table' && header.name === 'active' && start === -1) start = i;
  }
  const encoded = `${key} = ${encode(value)}`;
  if (start === -1) {
    return `${toml.replace(/\s*$/, '')}\n\n[active]\n${encoded}\n`;
  }
  for (let i = start + 1; i < end; i++) {
    if (new RegExp(`^${escapeRegExp(key)}\\s*=`).test(lines[i].trim())) {
      lines[i] = encoded;
      return lines.join('\n');
    }
  }
  lines.splice(end, 0, encoded);
  return lines.join('\n');
}

/** 删除 `[active].<key>`（不存在则原样返回）。 */
export function removeActiveKey(toml: string, key: string): string {
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (!header) continue;
    if (start !== -1 && end === lines.length) end = i;
    if (header.kind === 'table' && header.name === 'active' && start === -1) start = i;
  }
  if (start === -1) return toml;
  for (let i = start + 1; i < end; i++) {
    if (new RegExp(`^${escapeRegExp(key)}\\s*=`).test(lines[i].trim())) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return toml;
}
