/**
 * Coding plan（编码计划）的纯 TOML 辅助函数。
 *
 * 概念映射（与后端 reflect-config 的凭证池一一对应）：
 *  - provider = **接入端口**（API 协议端点），只有两种：anthropic / openai。
 *    多数模型供应商（GLM / Kimi / MiniMax 或本地 Ollama 服务）对两种端口
 *    都有兼容实现，接入时选其一作为 base_url 即可；Ollama 走 OpenAI 兼容
 *    端口，因此不再是独立的第三种 provider。
 *  - 一个 "coding plan" = `[[<provider>.credentials]]` 数组中的一个条目
 *    （label / api_key / base_url / model / weight / quota）。
 *  - 顶层 `[<provider>]` 的 `api_key` 视为隐式 plan（label='default'，
 *    upstream `to_registry` 会把它包装成池中 label="default" 的条目）。
 *  - "默认供应商" = `[active].provider`；凭证池内 429/401/5xx 的
 *    冷却 + failover 由上游 graph 层自动完成（reflect-core model_call）。
 *  - quota 子表（window_secs / max_tokens / check_via）声明订阅配额，
 *    配合后端 QuotaTracker 在额度耗尽时产生 `quota_exhausted` 事件；
 *    用量查询（check_via）只对 coding plan / token plan 订阅有意义。
 *
 * 全部为字符串手术（与 toml.ts 同风格），后端 `reflect_save_config`
 * 的 `load_from_str` 是最终校验闸阀。
 */

import { applyField, readField } from './schema';

/** 接入端口（API 协议端点）。Ollama 走 OpenAI 兼容端口，不再是独立选项。 */
export type PlanProvider = 'anthropic' | 'openai';

export const PLAN_PROVIDERS: readonly PlanProvider[] = ['anthropic', 'openai'];

/** 配额查询源（与 reflect_config::QuotaSource 对齐；'' = 不查询）。
 * 注意 `open_a_i_usage`：serde snake_case 对连续大写逐字母拆词
 * （OpenAIUsage → open_a_i_usage），写成 `openai_usage` 等常见拼法
 * 后端 `load_from_str` 会解析失败。 */
export const QUOTA_SOURCES = [
  '',
  'kimi',
  'zhipu',
  'minimax',
  'zenmux',
  'volcengine',
  'anthropic_usage',
  'open_a_i_usage',
] as const;

export interface PlanQuota {
  checkVia: string;
  windowSecs: string;
  maxTokens: string;
}

export interface PlanEntry {
  provider: PlanProvider;
  /** true = 顶层 `[provider].api_key` 形式的隐式 plan（label 固定 'default'）。 */
  topLevel: boolean;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  weight: string;
  quota: PlanQuota | null;
}

export function isPlanProvider(value: string): value is PlanProvider {
  return (PLAN_PROVIDERS as readonly string[]).includes(value);
}

/** 读取 `[active].provider`（默认供应商；未配置时为 ''）。 */
export function readActiveProvider(toml: string): string {
  return readField(toml, 'active', 'provider');
}

/**
 * 读取 `[active].credential`（被钉住的 plan label；未配置时为 ''）。
 * 与后端 `active_credential()` 同规则：trim + 空串视为未钉住。
 * 顶层隐式 plan 的 label 固定 'default' —— 钉它就显式写 `credential = "default"`。
 */
export function readActiveCredential(toml: string): string {
  return readField(toml, 'active', 'credential').trim();
}

/** 解析三个 provider 段的全部 plan（顶层隐式条目 + credentials 数组）。 */
export function listPlans(toml: string): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const provider of PLAN_PROVIDERS) {
    const topLevelKey = readField(toml, provider, 'api_key');
    const topLevelUrl = readField(toml, provider, 'base_url');
    // 顶层条目出现条件:**有 key 或有 base_url**。
    // 免 Key 端点(免费模型池)的顶层形态是 `api_key = ""` + `base_url = "..."`
    // —— 只看 api_key 的话这条 plan 会**整条从列表里消失**(用户既看不到
    // 也删不掉),而它恰恰是运行时真正生效的那条凭证。
    if (topLevelKey || topLevelUrl) {
      out.push({
        provider,
        topLevel: true,
        label: 'default',
        apiKey: topLevelKey,
        baseUrl: topLevelUrl,
        model: readField(toml, provider, 'model'),
        weight: '',
        quota: null,
      });
    }
    out.push(...listCredentialPlans(toml, provider));
  }
  return out;
}

/**
 * 供 failover 决策用：该 provider 是否存在可用的 plan。
 *
 * 「可用」= 有 api_key **或** 有 base_url —— 免 Key 端点(免费模型池)两者
 * 都没有 key,但它带 base_url,依然是可用凭证。此前只看 api_key → 免 Key
 * 的 plan 永远不被选作 failover 目标。
 */
export function providerHasUsablePlan(toml: string, provider: PlanProvider): boolean {
  return listPlans(toml).some(
    (p) => p.provider === provider && (p.apiKey.trim() !== '' || p.baseUrl.trim() !== ''),
  );
}

/**
 * 挑选 failover 目标 provider：按 anthropic → openai 顺序，
 * 跳过刚耗尽的，返回第一个有可用 plan 的；无候选 → null。
 */
export function pickFailoverProvider(toml: string, failedProvider: string): PlanProvider | null {
  for (const provider of PLAN_PROVIDERS) {
    if (provider === failedProvider) continue;
    if (providerHasUsablePlan(toml, provider)) return provider;
  }
  return null;
}

/** 切换默认供应商（写 `[active].provider`）。 */
export function setActiveProvider(toml: string, provider: PlanProvider): string {
  return applyField(toml, 'active', 'provider', provider, 'select');
}

/** 新增或更新 plan（按 provider + label 定位）。 */
export function upsertPlan(toml: string, plan: PlanEntry): string {
  if (plan.topLevel) {
    let next = applyField(toml, plan.provider, 'api_key', plan.apiKey, 'text');
    next = applyField(next, plan.provider, 'base_url', plan.baseUrl, 'text');
    return applyField(next, plan.provider, 'model', plan.model, 'text');
  }
  const block = renderCredentialBlock(plan);
  const existing = findCredentialBlock(toml, plan.provider, plan.label);
  if (existing) {
    return replaceSpan(toml, existing.start, existing.end, block);
  }
  // 追加首个块前必须剥离 `[provider]` 段内应用序列化产生的内联
  // `credentials = []`：TOML 不允许同一 key 既是普通数组又被
  // `[[provider.credentials]]` 扩展，否则后端 load_from_str 拒绝整份
  // 保存（表现为「保存 Plan 失败、模型列表里永远看不到新 plan」）。
  return `${stripInlineCredentials(toml, plan.provider).replace(/\s*$/, '')}\n\n${block.join('\n')}\n`;
}

/**
 * 删除 plan。topLevel 条目删除 `[provider]` 的**凭据字段**（api_key 与
 * base_url）；数组条目删除整个块。
 *
 * 顶层为什么连 `base_url` 一起删：顶层条目的**身份就是「这个 provider 的
 * 凭据」= api_key + base_url**。只删 api_key 会留下一个「只有 base_url 的
 * 免 Key provider」—— 运行时仍会注册它（凭据池里挂着一个空 key 的
 * client），用户以为删掉了，实际还在打请求。
 */
export function removePlan(toml: string, provider: PlanProvider, label: string): string {
  const existing = findCredentialBlock(toml, provider, label);
  if (existing) {
    const lines = toml.split('\n');
    lines.splice(existing.start, existing.end - existing.start);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // 顶层隐式条目：移除凭据字段（applyField 的空值路径 = 删除该键，
  // 见 schema.setSectionKey）。`model` 保留 —— 它只是模型名，不是凭据。
  let next = applyField(toml, provider, 'api_key', '', 'text');
  next = applyField(next, provider, 'base_url', '', 'text');
  return next;
}

/** 密钥展示遮罩：保留末 4 位。 */
export function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}

// ====== 最大上下文（[context_windows] 段，运行时官方机制） ======
//
// plan 的"最大上下文"落在 config.toml 的 `[context_windows]` 段
// （key = plan 的 model 名）。该段被 runtime 消费：`session_configured`
// 的 `context_window_size` 由此级联（优先级高于内置静态表），进而驱动
// Inspector 上下文仪表与 `get_context_remaining` 工具；前端的
// 自动压缩（`stores/agent/autoCompact.ts`）也以此为阈值来源。

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

// ====== 内部实现 ======

const HEADER_RE = /^\[\[([^\]]+)\]\]\s*$/;
const SUBTABLE_RE = /^\[([^\]]+)\]\s*$/;

/**
 * 剥离 `[provider]` 段内的内联 `credentials = ...` 行。
 *
 * `toml::to_string_pretty(&ReflectConfig)` 会把空 `Vec` 序列化为
 * `credentials = []`；TOML v1.0 规范不允许同一 key 既是普通数组又被
 * `[[provider.credentials]]` 数组表扩展（toml crate 报
 * "Cannot mutate immutable namespace"）。追加首个 credentials 块前调用；
 * 后端 `credentials` 带 `#[serde(default)]`，删除后缺省合法。
 */
function stripInlineCredentials(toml: string, provider: PlanProvider): string {
  const sectionHeader = `[${provider}]`;
  let inSection = false;
  const out: string[] = [];
  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    // 任何表头（`[x]` / `[[x]]`）都会终结 `[provider]` 段的直接体；
    // 子表 `[provider.credentials.quota]` 同样不在剥离范围。
    if (HEADER_RE.test(trimmed) || SUBTABLE_RE.test(trimmed)) {
      inSection = trimmed === sectionHeader;
      out.push(line);
      continue;
    }
    if (inSection && /^credentials\s*=/.test(trimmed)) continue;
    out.push(line);
  }
  return out.join('\n');
}

/** 解析 `[[provider.credentials]]` 数组条目（含 `[provider.credentials.quota]` 子表）。 */
function listCredentialPlans(toml: string, provider: PlanProvider): PlanEntry[] {
  const out: PlanEntry[] = [];
  let current: PlanEntry | null = null;
  let inQuota = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    const arrayHeader = HEADER_RE.exec(line);
    const subHeader = SUBTABLE_RE.exec(line);
    if (arrayHeader) {
      if (arrayHeader[1].trim() === `${provider}.credentials`) {
        current = {
          provider,
          topLevel: false,
          label: '',
          apiKey: '',
          baseUrl: '',
          model: '',
          weight: '',
          quota: null,
        };
        out.push(current);
      } else {
        current = null;
      }
      inQuota = false;
      continue;
    }
    if (subHeader) {
      inQuota =
        current !== null && subHeader[1].trim() === `${provider}.credentials.quota`;
      if (!inQuota && subHeader[1].trim().startsWith(`${provider}.credentials`)) {
        // credentials 的其他未知子表 —— 仍属于当前条目作用域，但不采集。
        inQuota = false;
      } else if (!inQuota) {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = stripQuotes(kv[2].trim());
    if (inQuota) {
      current.quota = current.quota ?? { checkVia: '', windowSecs: '', maxTokens: '' };
      if (key === 'check_via') current.quota.checkVia = value;
      if (key === 'window_secs') current.quota.windowSecs = value;
      if (key === 'max_tokens') current.quota.maxTokens = value;
      continue;
    }
    if (key === 'label') current.label = value;
    else if (key === 'api_key') current.apiKey = value;
    else if (key === 'base_url') current.baseUrl = value;
    else if (key === 'model') current.model = value;
    else if (key === 'weight') current.weight = value;
    else if (key === 'quota') current.quota = parseInlineQuota(kv[2].trim());
  }
  return out.filter((p) => p.label !== '');
}

/** 解析内联 `quota = { window_secs = …, max_tokens = …, check_via = "…" }`。 */
function parseInlineQuota(raw: string): PlanQuota | null {
  const m = /^\{(.+)\}$/.exec(raw);
  if (!m) return null;
  const quota: PlanQuota = { checkVia: '', windowSecs: '', maxTokens: '' };
  for (const pair of m[1].split(',')) {
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(pair.trim());
    if (!kv) continue;
    const value = stripQuotes(kv[2].trim());
    if (kv[1] === 'check_via') quota.checkVia = value;
    if (kv[1] === 'window_secs') quota.windowSecs = value;
    if (kv[1] === 'max_tokens') quota.maxTokens = value;
  }
  return quota;
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

/** 渲染一个 `[[provider.credentials]]` 块（quota 用内联表，避免多块拼接歧义）。 */
function renderCredentialBlock(plan: PlanEntry): string[] {
  const lines = [`[[${plan.provider}.credentials]]`, `label = ${encode(plan.label)}`];
  if (plan.apiKey) lines.push(`api_key = ${encode(plan.apiKey)}`);
  if (plan.baseUrl) lines.push(`base_url = ${encode(plan.baseUrl)}`);
  if (plan.model) lines.push(`model = ${encode(plan.model)}`);
  // weight 是后端 u32 字段 —— 非数字输入(如手写 `weight = "high"` 的
  // 往返)不写入,回落 serde 默认值 1,避免拼出非法 TOML。
  if (plan.weight && /^\d+$/.test(plan.weight.trim())) {
    lines.push(`weight = ${plan.weight.trim()}`);
  }
  if (plan.quota && plan.quota.checkVia) {
    // window_secs / max_tokens 是 u64 —— 任一缺失或非数字时整个 quota
    // 不声明（= 本地统计,零开销）,防止半截 quota 让后端反序列化失败。
    const numeric =
      /^\d+$/.test(plan.quota.windowSecs.trim()) && /^\d+$/.test(plan.quota.maxTokens.trim());
    if (numeric) {
      lines.push(
        `quota = { window_secs = ${plan.quota.windowSecs.trim()}, max_tokens = ${plan.quota.maxTokens.trim()}, check_via = ${encode(plan.quota.checkVia)} }`,
      );
    }
  }
  return lines;
}

/** TOML 字符串字面量。调用点全部是后端 String 字段（label/api_key/
 * base_url/model/check_via）—— 一律加引号,数字形字符串（如纯数字
 * api_key）裸写会被 serde 以 "expected String, found integer" 拒绝。 */
function encode(value: string): string {
  return JSON.stringify(value);
}

interface BlockSpan {
  /** 块头行下标（含）。 */
  start: number;
  /** 块结束行下标（不含）。 */
  end: number;
}

/**
 * 定位 `label` 匹配的 `[[provider.credentials]]` 块。
 * 块范围包含其 `[provider.credentials.quota]` 子表（重写时一并替换）。
 */
function findCredentialBlock(
  toml: string,
  provider: PlanProvider,
  label: string,
): BlockSpan | null {
  const lines = toml.split('\n');
  let start = -1;
  let blockLabel = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isHeader = HEADER_RE.test(line) || SUBTABLE_RE.test(line);
    if (!isHeader) {
      if (start !== -1) {
        // 单/双引号都认（listPlans 的 stripQuotes 同规则）—— 只认双引号
        // 会让单引号 label 的块定位失败,removePlan 落到顶层 api_key
        // fallthrough,误删用户没点删除的隐式 default plan。
        const kv = /^label\s*=\s*(["'])(.*?)\1/.exec(line);
        if (kv) blockLabel = kv[2];
      }
      continue;
    }
    // 命中表头：若正在扫描目标块则在此收尾。
    if (start !== -1) {
      const headerName = (HEADER_RE.exec(line) ?? SUBTABLE_RE.exec(line))![1].trim();
      const isOwnQuota = headerName === `${provider}.credentials.quota`;
      if (!isOwnQuota) {
        if (blockLabel === label) return { start, end: i };
        start = -1;
      }
    }
    if (HEADER_RE.test(line) && line === `[[${provider}.credentials]]`) {
      start = i;
      blockLabel = '';
    }
  }
  if (start !== -1 && blockLabel === label) return { start, end: lines.length };
  return null;
}

function replaceSpan(toml: string, start: number, end: number, block: string[]): string {
  const lines = toml.split('\n');
  lines.splice(start, end - start, ...block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
