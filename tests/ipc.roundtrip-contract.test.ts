/**
 * 持久化往返契约 · fakeBackend 侧。
 *
 * `tests/contracts/roundtrips.json` 列出「写 → 读」对：执行 `steps` 后，
 * `load` 的结果必须满足 `expect`。真后端侧由
 * `src-tauri/tests/ipc_roundtrip_contract.rs` 跑**同一份表**。
 *
 * 参数形状对齐（`ipc.payload-contract.test.ts`）只能保证模拟层"收得下"
 * 真后端形状的参数；这里保证的是**语义**：写进去的东西能按真后端的方式
 * 读回来。一个返回固定 fixture 的无状态桩会在这里立刻露馅 —— 依赖它的
 * 前端测试其实什么都没测。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readFileSync } from 'node:fs';
import { installFakeBackend } from './helpers/fakeBackend';

type Step = [cmd: string, args: Record<string, unknown>];
interface Expectation {
  path?: string;
  equals?: unknown;
  contains?: string;
}
interface Roundtrip {
  name: string;
  steps: Step[];
  load: Step;
  expect: Expectation[];
}
interface RoundtripDoc {
  roundtrips: Roundtrip[];
}

const doc = JSON.parse(readFileSync('tests/contracts/roundtrips.json', 'utf8')) as RoundtripDoc;
const TMP = '/tmp/reflect-contract-roundtrip';

function expandTmp(v: unknown): unknown {
  if (typeof v === 'string') return v.replaceAll('${TMP}', TMP);
  if (Array.isArray(v)) return v.map(expandTmp);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, expandTmp(x)]));
  }
  return v;
}

/** 点路径取值：`a.b.0.c`；空路径 = 整个值。 */
function at(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((cur, seg) => {
    if (cur === null || cur === undefined) return undefined;
    return (cur as Record<string, unknown>)[seg];
  }, value);
}

function check(result: unknown, exp: Expectation, label: string): void {
  const got = at(result, exp.path);
  const where = `${label}${exp.path ? ` @ ${exp.path}` : ''}`;
  if ('equals' in exp) {
    expect(got, `${where} 应等于 ${JSON.stringify(exp.equals)}，实际 ${JSON.stringify(got)}`).toEqual(
      expandTmp(exp.equals),
    );
  }
  if (exp.contains !== undefined) {
    const hay = typeof got === 'string' ? got : JSON.stringify(got ?? null);
    expect(hay, `${where} 应包含 "${exp.contains}"，实际 ${hay}`).toContain(exp.contains);
  }
}

beforeEach(() => {
  installFakeBackend();
});

describe('roundtrip contract (fakeBackend)', () => {
  it.each(doc.roundtrips.map((rt) => [rt.name, rt] as const))('%s', async (_name, rt) => {
    for (const [cmd, args] of rt.steps) {
      await invoke(cmd, expandTmp(args) as Record<string, unknown>);
    }
    const [loadCmd, loadArgs] = rt.load;
    const result = await invoke(loadCmd, expandTmp(loadArgs) as Record<string, unknown>);
    for (const exp of rt.expect) check(result, exp, `${loadCmd} 结果`);
  });
});
