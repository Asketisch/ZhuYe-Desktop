/**
 * 模型组（[[model_group]]）的纯 TOML 辅助函数 —— 对外 API 层。
 *
 * 概念映射（与后端 zhuye-config 的 ModelGroupSection 一一对应）：
 *  - 一个「模型组」= 一个命名接入单元：组 id 直接注册为 ModelRegistry 的
 *    池名，模型 spec 前缀 = 组 id（`<id>/<model>`）。
 *  - endpoint = 线格式（openai | anthropic | ollama），组自带 base_url +
 *    api_key。
 *  - 组内 `[[model_group.credentials]]` 是该组的**多凭据池**：label /
 *    api_key / base_url / model / weight / quota。缺省 = 单凭据组
 *    （引擎把组级 api_key wrap 成 label "default" 的条目）。
 *
 * 键名迁移：旧 `[[provider_group]]` / `[active].provider` 已由引擎在读入
 * 时迁移为 `[[model_group]]` / `[active].group`（写回只出新格式）。本文件
 * **读入时兼容旧键**，**写入一律用新键**。
 *
 * 全部为字符串手术；行级原语在同目录 `groupToml.ts`。
 * 后端 `zhuye_save_config` 的 `load_from_str` 是最终校验闸阀。
 */

import {
  findGroupOwnedSpan,
  groupOwnedEnd,
  isGroupPrefix,
  parseHeader,
  readActiveKey,
  removeActiveKey,
  replaceSpan,
  setActiveKey,
  stripQuotes,
  toFloat,
  toInt,
} from './groupToml';

/** 线格式（endpoint）—— 与引擎 ModelGroupSection 的 endpoint 同口径。 */
export const GROUP_ENDPOINTS = ['openai', 'anthropic', 'ollama'] as const;

export type GroupEndpoint = (typeof GROUP_ENDPOINTS)[number];

/** 引擎保留名（builder 跳过同名组）—— 组 id 不得与其冲突。 */
const RESERVED_IDS = ['mock'];

/** 组内一条凭据（`[[model_group.credentials]]` 条目）。 */
export interface GroupCredentialEntry {
  /** 凭据标识（用户诊断用；引擎缺省时兜底 "env-N" / "default"）。 */
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 派位权重（u32；缺省 1）。 */
  weight: number;
  /** 配额声明（可选）—— 挂在凭据上。 */
  quota: { windowSecs: number; maxTokens: number } | null;
}

/** 一个模型组（`[[model_group]]` 条目）。 */
export interface GroupEntry {
  id: string;
  /** 展示名（空 = 用 id）。 */
  label: string;
  /** 线格式：openai | anthropic | ollama。 */
  endpoint: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  responsesApi: boolean;
  /** HTTP 超时秒数；null = 未设置（走引擎默认）。 */
  timeoutSecs: number | null;
  /** 默认采样温度；null = 未设置。 */
  temperature: number | null;
  /** 默认输出上限；null = 未设置。 */
  maxTokens: number | null;
  /** Ollama keep-alive 秒数；null = 未设置。 */
  keepAliveSecs: number | null;
  /** Ollama 上下文窗口（num_ctx）；null = 未设置。 */
  numCtx: number | null;
  /** Ollama GPU 层数（num_gpu）；null = 未设置。 */
  numGpu: number | null;
  /**
   * 组默认模型的上下文窗口（tokens）；null = 未设置（走引擎内置回退表）。
   * 存储位置是引擎原生的 `[context_windows]` 表（键 = 裸模型名，与
   * `normalize_model_key` 的归一化/前缀匹配同口径）—— **不写入**
   * `[[model_group]]` 块（引擎 ModelGroupSection 无此字段）。由
   * `listGroups` 回填、`setGroupContextWindow` 独立维护。
   */
  contextWindow: number | null;
  /** 组内多凭据池（空 = 单凭据组）。 */
  credentials: GroupCredentialEntry[];
}

/** 组 id 合法性（与引擎 ModelGroupSection::is_valid_id 同口径）：
 * 非空、不含 '/'、不含 TOML 表头歧义字符、不与引擎保留名冲突。
 * 注意：`anthropic` / `openai` / `ollama` **不再是保留名** —— 引擎把旧
 * `[anthropic]` 段迁移成同名模型组，组 id 仍可取这三个名字。 */
export function isValidGroupId(id: string): boolean {
  const trimmed = id.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes('/') &&
    !trimmed.includes('[') &&
    !trimmed.includes(']') &&
    !RESERVED_IDS.includes(trimmed)
  );
}

/** 组展示名：显式 label 优先，缺省回退 id（与引擎 display_label 同口径）。 */
export function groupDisplayLabel(group: GroupEntry): string {
  return group.label.trim() || group.id;
}

/** 读取 `[active].group`（当前默认模型组 id；空串 = 未设置）。
 * 旧键 `[active].provider` 是同一字段的 serde alias —— 读到旧键时同样
 * 认（存量 config.toml 尚未被引擎重写）。 */
export function readActiveGroup(toml: string): string {
  const group = readActiveKey(toml, 'group');
  if (group) return group;
  return readActiveKey(toml, 'provider');
}

/** 把默认模型组切到指定组（写 `[active].group` = 组 id）。
 * 旧键 `[active].provider` 会被一并删除 —— 它与新键在引擎侧是同一字段的
 * serde alias，两个同时存在会被判为 duplicate field，整份配置读入失败。 */
export function setActiveGroup(toml: string, id: string): string {
  let next = setActiveKey(toml, 'group', id);
  next = removeActiveKey(next, 'provider');
  return next;
}

/** 解析全部模型组条目（按出现顺序）。
 * 兼容旧键 `[[provider_group]]`；嵌套的 `[[*.credentials]]` 归属其前面
 * 的组条目（TOML 语义：子表属于前一个数组表元素）。 */
export function listGroups(toml: string): GroupEntry[] {
  const groups: GroupEntry[] = [];
  const windows = readContextWindows(toml);
  let current: GroupEntry | null = null;
  /** 当前组的前缀（'model_group' / 'provider_group'）—— 凭据表按同前缀归属。 */
  let currentPrefix = '';
  let credential: GroupCredentialEntry | null = null;
  let inQuota = false;

  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    const header = parseHeader(line);
    if (header) {
      const name = header.name;
      if (header.kind === 'array' && isGroupPrefix(name)) {
        current = emptyGroup();
        currentPrefix = name;
        credential = null;
        inQuota = false;
        groups.push(current);
      } else if (header.kind === 'array' && name === `${currentPrefix}.credentials`) {
        credential = emptyCredential();
        inQuota = false;
        current?.credentials.push(credential);
      } else if (header.kind === 'table' && name === `${currentPrefix}.credentials.quota`) {
        inQuota = true;
        credential && (credential.quota ??= { windowSecs: 0, maxTokens: 0 });
      } else {
        // 其它表头 —— 与模型组无关，结束当前作用域。
        current = null;
        credential = null;
        inQuota = false;
      }
      continue;
    }
    if (!current) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = stripQuotes(kv[2].trim());
    if (credential) {
      if (inQuota) {
        if (key === 'window_secs') credential.quota!.windowSecs = toInt(value) ?? 0;
        else if (key === 'max_tokens') credential.quota!.maxTokens = toInt(value) ?? 0;
        continue;
      }
      if (key === 'label') credential.label = value;
      else if (key === 'api_key') credential.apiKey = value;
      else if (key === 'base_url') credential.baseUrl = value;
      else if (key === 'model') credential.model = value;
      else if (key === 'weight') credential.weight = toInt(value) ?? 1;
      else if (key === 'quota') credential.quota = parseInlineQuota(kv[2].trim());
      continue;
    }
    switch (key) {
      case 'id': current.id = value; break;
      case 'label': current.label = value; break;
      case 'endpoint': current.endpoint = value; break;
      case 'api_key': current.apiKey = value; break;
      case 'base_url': current.baseUrl = value; break;
      case 'model': current.model = value; break;
      case 'responses_api': current.responsesApi = value === 'true'; break;
      case 'timeout_secs': current.timeoutSecs = toInt(value); break;
      case 'temperature': current.temperature = toFloat(value); break;
      case 'max_tokens': current.maxTokens = toInt(value); break;
      case 'keep_alive_secs': current.keepAliveSecs = toInt(value); break;
      case 'num_ctx': current.numCtx = toInt(value); break;
      case 'num_gpu': current.numGpu = toInt(value); break;
    }
  }
  // 组默认模型的上下文窗口回填（[context_windows][裸模型名]，引擎归一化
  // 匹配键=模型名去 provider 前缀/小写 —— 组 id 不参与 spec 归一化）。
  for (const g of groups) {
    const model = g.model.trim().toLowerCase();
    if (!model) continue;
    const hit = windows[model] ?? Object.entries(windows).find(([k]) => model.startsWith(k))?.[1];
    if (hit != null) g.contextWindow = hit;
  }
  return groups.filter((g) => g.id.trim() !== '');
}

/** 组是否具备可用凭据：组级 api_key 或任一凭据 api_key 非空。 */
export function groupHasUsableCredential(group: GroupEntry): boolean {
  if (group.apiKey.trim()) return true;
  return group.credentials.some((c) => c.apiKey.trim() !== '');
}

/** 新增或更新组（按 id 定位；id 非法时原样返回 —— 调用方先用
 * `isValidGroupId` 校验并给出 UI 提示）。
 *
 * 写入内容 = 组自身 kv + 该组的 `[[model_group.credentials]]` 嵌套表
 * （组内凭据由 GUI 一并托管，更新时整段替换）。
 *
 * 追加位置：最后一个组归属块**之后**（组条目保持相邻，嵌套 credentials
 * 的归属不被隔断）；没有任何组时追加到文末 —— `[[model_group]]` 与
 * 前面的普通表是不同 key，TOML v1.0 下两个位置都合法。 */
export function upsertGroup(toml: string, group: GroupEntry): string {
  if (!isValidGroupId(group.id)) return toml;
  const block = renderGroupBlock(group);
  const existing = findGroupOwnedSpan(toml, group.id);
  if (existing) {
    return replaceSpan(toml, existing.start, existing.end, block);
  }
  const lines = toml.split('\n');
  let lastGroupHeader = -1;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (header?.kind === 'array' && isGroupPrefix(header.name)) lastGroupHeader = i;
  }
  if (lastGroupHeader === -1) {
    return `${toml.replace(/\s*$/, '')}\n\n${block.join('\n')}\n`;
  }
  const insertAt = groupOwnedEnd(lines, lastGroupHeader);
  lines.splice(insertAt, 0, '', ...block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 删除组。范围覆盖该组的**全部归属块**：自身 kv 段 + 嵌套的
 * `[[model_group.credentials]]`（及 quota 子表）—— 只删 kv 段会留下悬挂的
 * credentials 子表，被 TOML 归属到下一个组条目上。 */
export function removeGroup(toml: string, id: string): string {
  const span = findGroupOwnedSpan(toml, id);
  if (!span) return toml;
  const lines = toml.split('\n');
  lines.splice(span.start, span.end - span.start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 读 `[context_windows]` 表（键已小写化；值 = tokens）。表不存在 → 空。 */
export function readContextWindows(toml: string): Record<string, number> {
  const out: Record<string, number> = {};
  let inTable = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    const header = parseHeader(line);
    if (header) {
      inTable = header.kind === 'table' && header.name === 'context_windows';
      continue;
    }
    if (!inTable) continue;
    // 键可带引号（模型名含 '.' 必须引号）—— 宽松匹配引号或 bare key。
    const kv = /^"?([^"=]+)"?\s*=\s*(\d+)\s*$/.exec(line);
    if (!kv) continue;
    out[kv[1].trim().toLowerCase()] = toInt(kv[2]) ?? 0;
  }
  return out;
}

/** 写/删 `[context_windows][<modelKey>]`（tokens = null 删除键；表空时
 * 连同表头一并摘除，不留空段）。modelKey 用**裸模型名**（小写化与引擎
 * 归一化对齐；前缀可覆盖同前缀家族，如 `qwen3.8` 命中 27b/flash）。 */
export function setGroupContextWindow(
  toml: string,
  modelKey: string,
  tokens: number | null,
): string {
  const key = modelKey.trim().toLowerCase();
  if (!key) return toml;
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (!header) continue;
    if (start !== -1 && end === lines.length) end = i;
    if (header.kind === 'table' && header.name === 'context_windows' && start === -1) start = i;
  }
  if (start === -1) {
    if (tokens == null) return toml;
    return `${toml.replace(/\s*$/, '')}\n\n[context_windows]\n${keyLineFor(key, tokens)}\n`;
  }
  for (let i = start + 1; i < end; i++) {
    const kv = /^"?([^"=]+)"?\s*=\s*\d+\s*$/.exec(lines[i].trim());
    if (kv && kv[1].trim().toLowerCase() === key) {
      if (tokens == null) {
        lines.splice(i, 1);
        // 段空 → 连表头摘除。
        if (!lines.slice(start + 1, end - 1).some((l) => l.trim())) {
          lines.splice(start, end - start);
        }
        return lines.join('\n').replace(/\n{3,}/g, '\n\n');
      }
      lines[i] = keyLineFor(key, tokens);
      return lines.join('\n');
    }
  }
  if (tokens == null) return toml;
  lines.splice(end, 0, keyLineFor(key, tokens));
  return lines.join('\n');
}

/** `[context_windows]` 条目行（键带引号 —— 模型名常含 '.'）。 */
function keyLineFor(key: string, tokens: number): string {
  return `${JSON.stringify(key)} = ${tokens}`;
}

/** 读 `[model].reasoning_effort`（全局活跃模型默认思考强度；'' = 未设置）。 */
export function readDefaultEffort(toml: string): string {
  const lines = toml.split('\n');
  let inModel = false;
  for (const raw of lines) {
    const line = raw.trim();
    const header = parseHeader(line);
    if (header) {
      inModel = header.kind === 'table' && header.name === 'model';
      continue;
    }
    if (!inModel) continue;
    const kv = /^reasoning_effort\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    return stripQuotes(kv[1].trim());
  }
  return '';
}

/** 写/删 `[model].reasoning_effort`（effort = '' 删除键）。引擎把它解析为
 * 会话初始思考强度（`resolve_reasoning_effort` → `with_initial_effort`）；
 * 运行时 `Op::SetEffort` 仍可覆盖，每次重绑重新读配置。 */
export function setDefaultEffort(toml: string, effort: string): string {
  const lines = toml.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const header = parseHeader(lines[i].trim());
    if (!header) continue;
    if (start !== -1 && end === lines.length) end = i;
    if (header.kind === 'table' && header.name === 'model' && start === -1) start = i;
  }
  const encoded = `reasoning_effort = ${JSON.stringify(effort)}`;
  if (start === -1) {
    if (!effort) return toml;
    return `${toml.replace(/\s*$/, '')}\n\n[model]\n${encoded}\n`;
  }
  for (let i = start + 1; i < end; i++) {
    if (/^reasoning_effort\s*=/.test(lines[i].trim())) {
      if (!effort) {
        lines.splice(i, 1);
        return lines.join('\n');
      }
      lines[i] = encoded;
      return lines.join('\n');
    }
  }
  if (!effort) return toml;
  lines.splice(end, 0, encoded);
  return lines.join('\n');
}

/** 密钥展示遮罩：保留末 4 位。 */
export function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}

// ====== 内部实现 ======

function emptyGroup(): GroupEntry {
  return {
    id: '',
    label: '',
    endpoint: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    responsesApi: false,
    timeoutSecs: null,
    temperature: null,
    maxTokens: null,
    keepAliveSecs: null,
    numCtx: null,
    numGpu: null,
    contextWindow: null,
    credentials: [],
  };
}

function emptyCredential(): GroupCredentialEntry {
  return {
    label: '',
    apiKey: '',
    baseUrl: '',
    model: '',
    weight: 1,
    quota: null,
  };
}

/** 渲染一个 `[[model_group]]` 块（含其嵌套的 credentials 表）。 */
function renderGroupBlock(group: GroupEntry): string[] {
  const lines = ['[[model_group]]', `id = ${encodeValue(group.id.trim())}`];
  if (group.label.trim()) lines.push(`label = ${encodeValue(group.label.trim())}`);
  if (group.endpoint.trim()) lines.push(`endpoint = ${encodeValue(group.endpoint.trim())}`);
  if (group.baseUrl.trim()) lines.push(`base_url = ${encodeValue(group.baseUrl.trim())}`);
  if (group.apiKey.trim()) lines.push(`api_key = ${encodeValue(group.apiKey.trim())}`);
  if (group.model.trim()) lines.push(`model = ${encodeValue(group.model.trim())}`);
  if (group.responsesApi) lines.push('responses_api = true');
  if (group.timeoutSecs != null) lines.push(`timeout_secs = ${group.timeoutSecs}`);
  if (group.temperature != null) lines.push(`temperature = ${group.temperature}`);
  if (group.maxTokens != null) lines.push(`max_tokens = ${group.maxTokens}`);
  if (group.keepAliveSecs != null) lines.push(`keep_alive_secs = ${group.keepAliveSecs}`);
  if (group.numCtx != null) lines.push(`num_ctx = ${group.numCtx}`);
  if (group.numGpu != null) lines.push(`num_gpu = ${group.numGpu}`);
  // 组内凭据：嵌套表紧跟组 kv（TOML 语义：子表归属前一个数组表元素）。
  for (const credential of group.credentials) {
    if (!credential.label.trim()) continue;
    lines.push('', ...renderCredentialBlock(credential));
  }
  return lines;
}

/** 渲染一个 `[[model_group.credentials]]` 块（quota 用内联表）。 */
function renderCredentialBlock(credential: GroupCredentialEntry): string[] {
  const lines = ['[[model_group.credentials]]', `label = ${encodeValue(credential.label.trim())}`];
  if (credential.apiKey.trim()) lines.push(`api_key = ${encodeValue(credential.apiKey.trim())}`);
  if (credential.baseUrl.trim()) lines.push(`base_url = ${encodeValue(credential.baseUrl.trim())}`);
  if (credential.model.trim()) lines.push(`model = ${encodeValue(credential.model.trim())}`);
  // weight 是后端 u32 字段 —— 非数字输入不写入，回落 serde 默认值 1。
  if (Number.isInteger(credential.weight) && credential.weight >= 0) {
    lines.push(`weight = ${credential.weight}`);
  }
  // quota 的 window_secs / max_tokens 是 u64 且**没有 serde 默认值** ——
  // 缺一不可，否则整份配置反序列化失败；不完整时不声明配额。
  if (
    credential.quota &&
    credential.quota.windowSecs > 0 &&
    credential.quota.maxTokens > 0
  ) {
    lines.push(
      `quota = { window_secs = ${credential.quota.windowSecs}, max_tokens = ${credential.quota.maxTokens} }`,
    );
  }
  return lines;
}

/** 解析内联 `quota = { window_secs = …, max_tokens = … }`。 */
function parseInlineQuota(raw: string): { windowSecs: number; maxTokens: number } | null {
  const m = /^\{(.+)\}$/.exec(raw.trim());
  if (!m) return null;
  const quota = { windowSecs: 0, maxTokens: 0 };
  for (const pair of m[1].split(',')) {
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(pair.trim());
    if (!kv) continue;
    const value = stripQuotes(kv[2].trim());
    if (kv[1] === 'window_secs') quota.windowSecs = toInt(value) ?? 0;
    else if (kv[1] === 'max_tokens') quota.maxTokens = toInt(value) ?? 0;
  }
  return quota;
}

/** TOML 字符串字面量（后端字段一律 String，数字形字符串裸写会被
 * serde 以 "expected String, found integer" 拒绝）。 */
function encodeValue(value: string): string {
  return JSON.stringify(value);
}
