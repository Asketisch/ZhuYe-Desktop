#!/usr/bin/env node
// 自测“已完成命令必须有测试证据”的判定规则与排除表约束。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const analyzer = readFileSync(join(root, 'tests/static/analyze.mjs'), 'utf8');

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(analyzer.includes('registered-command-has-test'), '缺少命令测试门禁');
assert(analyzer.includes('commandUnitTested'), '模块内单元测试未计入证据');
assert(analyzer.includes('registered-command-test-exclusions'), '缺少排除表校验');
assert(analyzer.includes('exclusion.reason'), '排除项未要求原因');

const exclusions = JSON.parse(
  readFileSync(join(root, 'tests/command-test-exclusions.json'), 'utf8'),
).commands;
for (const [command, entry] of Object.entries(exclusions)) {
  assert(/^reflect_\w+$/.test(command), `排除项不是命令名:${command}`);
  assert(
    typeof entry.reason === 'string' && entry.reason.trim() !== '',
    `排除项缺少原因:${command}`,
  );
}
console.log(`命令测试证据门禁自测通过;当前排除 ${Object.keys(exclusions).length} 条`);
