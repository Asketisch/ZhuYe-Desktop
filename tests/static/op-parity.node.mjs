import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const rust = readFileSync(join(root, 'zhuye-agent/crates/protocol/zhuye-protocol/src/op.rs'), 'utf8');
const ts = readFileSync(join(root, 'src/types/protocol/op.ts'), 'utf8');
const samples = JSON.parse(readFileSync(join(root, 'tests/contracts/ops.json'), 'utf8'));

function run(rustText, tsText, sampleDoc = samples) {
  const dir = mkdtempSync(join(tmpdir(), 'op-parity-'));
  try {
    const rustFile = join(dir, 'op.rs');
    const tsFile = join(dir, 'op.ts');
    const sampleFile = join(dir, 'ops.json');
    writeFileSync(rustFile, rustText);
    writeFileSync(tsFile, tsText);
    writeFileSync(sampleFile, JSON.stringify(sampleDoc));
    return spawnSync(process.execPath, [join(here, 'op-parity.mjs'), rustFile, tsFile, sampleFile], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('detects additions and missing variants in either TypeScript union', () => {
  assert.equal(run(rust, ts).status, 0);
  const added = run(rust.replace('pub enum Op {', 'pub enum Op {\n    NewProbe,'), ts);
  assert.notEqual(added.status, 0);
  assert.match(added.stderr, /new_probe/);
  const missingName = run(rust, ts.replace("  | 'exit_goal_mode'\n", ''));
  assert.notEqual(missingName.status, 0);
  assert.match(missingName.stderr, /OpType 缺少: exit_goal_mode/);
  const missingShape = run(rust, ts.replace("  | { type: 'exit_goal_mode' }\n", ''));
  assert.notEqual(missingShape.status, 0);
  assert.match(missingShape.stderr, /ReflectSubmissionOp 缺少: exit_goal_mode/);
  const changedSamples = structuredClone(samples);
  delete changedSamples.ops.exit_goal_mode;
  const missingSample = run(rust, ts, changedSamples);
  assert.notEqual(missingSample.status, 0);
  assert.match(missingSample.stderr, /ops.json 缺少: exit_goal_mode/);
  const wrongTag = structuredClone(samples);
  wrongTag.ops.exit_goal_mode.type = 'shutdown';
  const mismatchedSample = run(rust, ts, wrongTag);
  assert.notEqual(mismatchedSample.status, 0);
  assert.match(mismatchedSample.stderr, /type 不匹配/);
  assert.notEqual(run(rust.replace('pub enum Op {', 'pub enum Missing {'), ts).status, 0);
});
