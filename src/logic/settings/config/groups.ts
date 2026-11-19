/**
 * 模型组（[[provider_group]]）的纯 TOML 辅助函数（与 plans.ts 同风格）。
 *
 * 概念映射（与后端 reflect-config 的 ProviderGroupSection 一一对应）：
 *  - 一个「模型组」= 一个命名 provider 条目：组 id 直接注册为
 *    ModelRegistry 的池名，模型 spec 前缀 = 组 id（`<id>/<model>`）。
 *  - endpoint = 线格式（openai | anthropic），与内置两个接入端口同义，
 *    但组可以有任意多个、各自带 base_url + api_key。
 *  - 组内单凭据是常态（组 = 端点 + key）；`[[provider_group.credentials]]`
 *    嵌套数组保留给高级用户，本文件的 GUI 编辑面**不**触碰它 —— 替换
 *    组块时只替换组自身 kv 行（嵌套子表按 TOML 顺序仍归属该组）。
 *
 * 全部为字符串手术；后端 `reflect_save_config` 的 `load_from_str`
 * 是最终校验闸阀。
 */

import { applyField, readField } from './schema';

/** 线格式。与 plans 的接入端口口径一致（ollama 走 openai 兼容端口）。 */
export type GroupEndpoint = 'openai' | 'anthropic';

export const GROUP_ENDPOINTS: readonly GroupEndpoint[] = ['openai', 'anthropic'];

/** 后端 builder 保留名（内置段名）—— 组 id 不得与其冲突。 */
const RESERVED_IDS = ['anthropic', 'openai', 'ollama', 'mock'];

export interface GroupEntry {
  id: string;
  /** 展示名（空 = 用 id）。 */
  label: string;
  endpoint: GroupEndpoint;
  apiKey: string;
  baseUrl: string;
  model: string;
  responsesApi: boolean;
  /** HTTP 超时秒数；'' = 未设置（走引擎默认 300s）。 */
  timeoutSecs: string;
}

/** 组 id 合法性（与引擎 ProviderGroupSection::is_valid_id 同口径）：
 * 非空、不含 '/'、不含 TOML 表头歧义字符、不与内置段名冲突。 */
export function isValidGroupId(id: string): boolean {
  return (
    id.trim().length > 0 &&
    !id.includes('/') &&
    !id.includes('[') &&
    !id.includes(']') &&
    !RESERVED_IDS.includes(id.trim())
  );
}

/** 组展示名：显式 label 优先，缺省回退 id（与引擎 display_label 同口径）。 */
export function groupDisplayLabel(group: GroupEntry): string {
  return group.label.trim() || group.id;
}

/** 读取 `[active].provider`；若它命中某个组 id，返回该组，否则 null。
 * （内置段名返回 null —— 调用方据此区分「默认组是内置端口还是自定义组」。） */
export function readActiveGroup(toml: string, groups: GroupEntry[]): GroupEntry | null {
  const active = readField(toml, 'active', 'provider').trim();
  if (!active) return null;
  return groups.find((g) => g.id === active) ?? null;
}

/** 把默认组切到指定组（写 `[active].provider` = 组 id）。 */
export function setActiveGroup(toml: string, id: string): string {
  return applyField(toml, 'active', 'provider', id, 'select');
}

/** 解析全部 `[[provider_group]]` 条目（按出现顺序）。 */
export function listGroups(toml: string): GroupEntry[] {
  const out: GroupEntry[] = [];
  let current: GroupEntry | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (isTableHeader(line)) {
      // 组自身的 kv 段只延续到下一个表头（嵌套
      // `[[provider_group.credentials]]` 也算表头 —— 不采集，GUI 不编辑）。
      current =
        line === '[[provider_group]]'
          ? { id: '', label: '', endpoint: 'openai', apiKey: '', baseUrl: '', model: '', responsesApi: false, timeoutSecs: '' }
          : null;
      if (current) out.push(current);
      continue;
    }
    if (!current) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const value = stripQuotes(kv[2].trim());
    switch (kv[1]) {
      case 'id': current.id = value; break;
      case 'label': current.label = value; break;
      case 'endpoint': current.endpoint = value as GroupEndpoint; break;
      case 'api_key': current.apiKey = value; break;
      case 'base_url': current.baseUrl = value; break;
      case 'model': current.model = value; break;
      case 'responses_api': current.responsesApi = value === 'true'; break;
      case 'timeout_secs': current.timeoutSecs = /^\d+$/.test(value) ? value : ''; break;
    }
  }
  return out.filter((g) => g.id.trim() !== '');
}

/** 新增或更新组（按 id 定位；id 非法时原样返回 —— 调用方先用
 * `isValidGroupId` 校验并给出 UI 提示）。
 *
 * 追加位置:最后一个组归属块**之后**(组条目保持相邻,嵌套 credentials
 * 的归属不被隔断);没有任何组时追加到文末 —— `[[provider_group]]` 与
 * 前面的普通表是不同 key,TOML v1.0 下两个位置都合法。 */
export function upsertGroup(toml: string, group: GroupEntry): string {
  if (!isValidGroupId(group.id)) return toml;
  const block = renderGroupBlock(group);
  const existing = findGroupBlock(toml, group.id);
  if (existing) {
    return replaceSpan(toml, existing.start, existing.end, block);
  }
  const lines = toml.split('\n');
  let lastGroupHeader = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '[[provider_group]]') lastGroupHeader = i;
  }
  if (lastGroupHeader === -1) {
    return `${toml.replace(/\s*$/, '')}\n\n${block.join('\n')}\n`;
  }
  const insertAt = groupOwnedEnd(lines, lastGroupHeader);
  lines.splice(insertAt, 0, '', ...block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 删除组。范围覆盖该组的**全部归属块**：自身 kv 段 + 嵌套的
 * `[[provider_group.credentials]]`（及子表）—— 只删 kv 段会留下悬挂的
 * credentials 子表，被 TOML 归属到下一个组条目上。
 */
export function removeGroup(toml: string, id: string): string {
  const span = findGroupOwnedSpan(toml, id);
  if (!span) return toml;
  const lines = toml.split('\n');
  lines.splice(span.start, span.end - span.start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ====== 内部实现 ======

const HEADER_RE = /^\[\[([^\]]+)\]\]\s*$/;
const SUBTABLE_RE = /^\[([^\]]+)\]\s*$/;

function isTableHeader(line: string): boolean {
  return HEADER_RE.test(line) || SUBTABLE_RE.test(line);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** 渲染一个 `[[provider_group]]` 块（只含组自身 kv；credentials 是
 * GUI 未覆盖的高级形态，不由此写出）。 */
function renderGroupBlock(group: GroupEntry): string[] {
  const lines = [
    '[[provider_group]]',
    `id = ${encode(group.id.trim())}`,
  ];
  if (group.label.trim()) lines.push(`label = ${encode(group.label.trim())}`);
  lines.push(`endpoint = ${encode(group.endpoint)}`);
  if (group.baseUrl.trim()) lines.push(`base_url = ${encode(group.baseUrl.trim())}`);
  if (group.apiKey.trim()) lines.push(`api_key = ${encode(group.apiKey.trim())}`);
  if (group.model.trim()) lines.push(`model = ${encode(group.model.trim())}`);
  if (group.responsesApi) lines.push('responses_api = true');
  // timeout_secs 是后端 u64 字段 —— 非数字不写入，回落引擎默认。
  if (group.timeoutSecs.trim() && /^\d+$/.test(group.timeoutSecs.trim())) {
    lines.push(`timeout_secs = ${group.timeoutSecs.trim()}`);
  }
  return lines;
}

interface BlockSpan {
  start: number;
  end: number;
}

/** 判断表头是否仍归属某个 `[[provider_group]]` 条目（组自身重复出现、
 * 嵌套 credentials 及其子表）。 */
function isProviderGroupHeader(line: string): boolean {
  const m = HEADER_RE.exec(line) ?? SUBTABLE_RE.exec(line);
  if (!m) return false;
  return /^provider_group(\.credentials(\.[A-Za-z0-9_-]+)*)?$/.test(m[1].trim());
}

/** 从行数组里读组块的 `id` kv（只认带引号形式 —— 本文件渲染恒为带引号,
 * 裸 `id = foo` 不是合法 TOML 字符串）。 */
function readBlockId(line: string): string {
  const kv = /^id\s*=\s*(["'])(.*?)\1/.exec(line.trim());
  return kv ? kv[2] : '';
}

/** 从 `start`（`[[provider_group]]` 表头行）起扫该组的归属结束行下标
 *（下一个非 provider_group 表头或 EOF）。 */
function groupOwnedEnd(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isTableHeader(line) && !isProviderGroupHeader(line)) return i;
  }
  return lines.length;
}

/** 定位 `id` 匹配的组块（仅组自身 kv 行范围，嵌套子表不算 —— upsert
 * 替换它即可保住用户手写的 credentials）。未命中时继续向后扫（目标组
 * 不一定是第一个）。 */
function findGroupBlock(toml: string, id: string): BlockSpan | null {
  const lines = toml.split('\n');
  let start = -1;
  let blockId = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!isTableHeader(line)) {
      if (start !== -1) {
        const kvId = readBlockId(line);
        if (kvId) blockId = kvId;
      }
      continue;
    }
    if (start !== -1) {
      if (blockId === id) return { start, end: i };
      // 嵌套 credentials 等归属表头跳过；下一个组条目重新起扫。
      start = line === '[[provider_group]]' ? i : -1;
      blockId = '';
      continue;
    }
    if (line === '[[provider_group]]') {
      start = i;
      blockId = '';
    }
  }
  return start !== -1 && blockId === id ? { start, end: lines.length } : null;
}

/** 定位 `id` 匹配组的**全部归属行**（含嵌套 credentials 子表），
 * removeGroup 用。 */
function findGroupOwnedSpan(toml: string, id: string): BlockSpan | null {
  const lines = toml.split('\n');
  let start = -1;
  let blockId = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 归属范围内的非表头行:组块自己的 id kv 也要读出来。
    if (!isTableHeader(line)) {
      if (start !== -1) {
        const kvId = readBlockId(line);
        if (kvId) blockId = kvId;
      }
      continue;
    }
    if (start !== -1) {
      // 组归属范围内的其他表头（嵌套 credentials / 子表 / 组重复出现）。
      if (isProviderGroupHeader(line)) {
        if (line === '[[provider_group]]') {
          // 下一组开始 —— 前一组在此收尾。
          if (blockId === id) return { start, end: i };
          start = i;
          blockId = '';
        }
        continue;
      }
      // 非 provider_group 表头 = 该组已结束。
      if (blockId === id) return { start, end: i };
      start = -1;
      continue;
    }
    if (line === '[[provider_group]]') {
      start = i;
      blockId = '';
    }
  }
  return start !== -1 && blockId === id ? { start, end: lines.length } : null;
}

function replaceSpan(toml: string, start: number, end: number, block: string[]): string {
  const lines = toml.split('\n');
  lines.splice(start, end - start, ...block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** TOML 字符串字面量（后端字段一律 String，数字形字符串裸写会被
 * serde 以 "expected String, found integer" 拒绝 —— 与 plans.ts 同规）。 */
function encode(value: string): string {
  return JSON.stringify(value);
}
