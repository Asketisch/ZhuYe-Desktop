#!/usr/bin/env node
/**
 * 事件面三方奇偶校验 —— 发布门禁 L1 的协议事件检查。
 *
 * 协议 `EventMsg` 的变体名单存在于三处,Rust 是唯一真源:
 *   1. Rust enum(`zhuye-agent/.../event_msg/mod.rs`)—— serde wire 名;
 *   2. TS 类型联合(`src/types/protocol/event.ts` 的 `EventMsgType`);
 *   3. 跨运行时契约样本(`tests/contracts/events.json`)。
 *
 * 任何一处漂移(上游 submodule 升级新增/改名变体、前端类型漏跟、样本漏补)
 * 都在这里逐个点名 —— reducer 对未知 `type` 是安全降级,不守这层,漂移
 * 会静默通过全部测试,UI 吞掉新事件。
 *
 * serde `rename_all = "snake_case"` 的分段规则(rustc serde 实现):
 * 在「大写→小写」「小写/数字→大写」边界插入下划线;连续大写视为一个词,
 * 但最后一个大写若后跟小写,则在它之前分界(如 `LlMSummarize` →
 * `ll_m_summarize`,`URLParser` → `url_parser`)。
 *
 * 用法:node tests/static/event-parity.mjs
 * 退出码 0 = 三方一致。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUST_ENUM = join(ROOT, 'zhuye-agent/crates/protocol/zhuye-protocol/src/event_msg/mod.rs');
const TS_UNION = join(ROOT, 'src/types/protocol/event.ts');
const CONTRACT = join(ROOT, 'tests/contracts/events.json');

/** serde snake_case 转换(与 `#[serde(rename_all = "snake_case")]` 一致)。 */
function serdeSnakeCase(ident) {
  let out = '';
  for (let i = 0; i < ident.length; i++) {
    const c = ident[i];
    const prev = ident[i - 1];
    const next = ident[i + 1];
    const isUpper = (ch) => ch && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
    const isLowerOrDigit = (ch) => ch && (ch === ch.toLowerCase() || /[0-9]/.test(ch));
    if (isUpper(c) && i > 0 && (isLowerOrDigit(prev) || (isUpper(prev) && next && isLower(next)))) {
      out += '_';
    }
    out += c.toLowerCase();
  }
  return out;
}

/** Rust enum 变体名单 → serde wire 名。 */
function rustVariants() {
  const src = readFileSync(RUST_ENUM, 'utf8');
  const body = src.slice(src.indexOf('pub enum EventMsg'));
  const end = body.indexOf('\n}');
  const names = [...body.slice(0, end).matchAll(/^    ([A-Z]\w+)[({,]?/gm)].map((m) => m[1]);
  return new Set(names.map(serdeSnakeCase));
}

/** TS `EventMsgType` 联合的字符串字面量。 */
function tsVariants() {
  const src = readFileSync(TS_UNION, 'utf8');
  const begin = src.indexOf('export type EventMsgType =');
  // 边界取下一个顶层 `export`(不能找 `;`:联合体注释里可能有英文分号,
  // 如 `// 子代理可观测 (2;v1.4 C1)`,历史上真实截断过)。
  const end = src.indexOf('\nexport ', begin + 10);
  const seg = src.slice(begin, end);
  return new Set([...seg.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

/** 契约样本表键。 */
function contractVariants() {
  const doc = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  return new Set(Object.keys(doc.events));
}

const rust = rustVariants();
const ts = tsVariants();
const contract = contractVariants();

const failures = [];
const diff = (name, a, b) => {
  const missing = [...a].filter((x) => !b.has(x)).sort();
  const stale = [...b].filter((x) => !a.has(x)).sort();
  if (missing.length) failures.push(`${name} 缺少:${missing.join(', ')}`);
  if (stale.length) failures.push(`${name} 多出(已删/改名):${stale.join(', ')}`);
};

diff('Rust → TS EventMsgType', rust, ts);
diff('Rust → events.json 样本表', rust, contract);
if (rust.size < 50) failures.push(`Rust enum 只有 ${rust.size} 个变体,低于下限 50(解析坏了?)`);

if (failures.length) {
  console.error(`事件面三方奇偶校验失败(Rust enum ↔ TS 联合 ↔ 契约样本):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`事件面一致:${rust.size} 个变体(Rust enum = TS EventMsgType = events.json)`);
