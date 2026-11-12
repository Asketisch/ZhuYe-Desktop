#!/usr/bin/env node
// Rust Op 与两个前端操作联合保持同步；仅检查变体名，不声称字段或运行态已覆盖。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rustFile = process.argv[2] ?? join(root, 'zhuye-agent/crates/protocol/zhuye-protocol/src/op.rs');
const tsFile = process.argv[3] ?? join(root, 'src/types/protocol/op.ts');
const rust = readFileSync(rustFile, 'utf8');
const ts = readFileSync(tsFile, 'utf8');

function segment(text, start, end) {
  const first = text.indexOf(start);
  const last = first < 0 ? -1 : text.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`missing boundary: ${start} → ${end}`);
  return text.slice(first, last);
}
function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
}
const variants = new Set([...segment(rust, 'pub enum Op {', '\n}')
  .matchAll(/^    ([A-Z]\w+)\s*(?:\{|,)/gm)].map((match) => snake(match[1])));
const names = new Set([...segment(ts, 'export type OpType =', ';')
  .matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
const union = new Set([...segment(ts, 'export type ReflectSubmissionOp =', ';\n')
  .matchAll(/^\s*\|\s*\{\s*type:\s*'([a-z_]+)'/gm)].map((match) => match[1]));
const samplesFile = process.argv[4] ?? join(root, 'tests/contracts/ops.json');
const samples = JSON.parse(readFileSync(samplesFile, 'utf8')).ops;
const sampleNames = new Set(Object.keys(samples));
const failures = [];
if (variants.size < 26) failures.push(`Rust Op 解析到 ${variants.size} 项，低于已知下限 26`);
for (const [label, values] of [['OpType', names], ['ReflectSubmissionOp', union], ['ops.json', sampleNames]]) {
  const missing = [...variants].filter((name) => !values.has(name));
  const extra = [...values].filter((name) => !variants.has(name));
  if (missing.length) failures.push(`${label} 缺少: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${label} 多出: ${extra.join(', ')}`);
}
for (const [name, sample] of Object.entries(samples)) {
  if (sample?.type !== name) failures.push(`ops.json ${name} 的 type 不匹配`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`提交操作一致: ${variants.size} 个 Rust Op = OpType = ReflectSubmissionOp = ops.json`);
}
