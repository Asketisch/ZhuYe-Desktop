/**
 * 跨运行时线格式契约 · fakeBackend 侧。
 *
 * `tests/contracts/payloads.json` 为每条注册命令给出一份**真后端可反序列化**
 * 的参数样本（由 `src-tauri/tests/ipc_payload_contract.rs` 在真后端上验证）。
 * 这里把同一份样本喂给 `fakeBackend`：
 *
 *   1. 每条样本都对应一个已注册的 fake handler（否则 invoke 抛 "not mocked"）；
 *   2. handler 接受真后端形状的参数而不抛错 —— 抓住 `args.list.entries.map(...)`
 *      这类"按错误形状解构"的模拟层漂移；
 *   3. 返回值可经 JSON round-trip（与真实 IPC 序列化语义一致）。
 *
 * 配合 `ipc.roundtrip-contract.test.ts`（持久化对的 save→load 语义一致）
 * 与 L1 的样本完整性检查，三者合起来让「模拟层与真后端走样」无处可藏。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readFileSync } from 'node:fs';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';

interface PayloadDoc {
  commands: Record<string, Record<string, unknown>>;
}

const doc = JSON.parse(readFileSync('tests/contracts/payloads.json', 'utf8')) as PayloadDoc;
const TMP = '/tmp/reflect-contract-probe';

/** 递归把 `${TMP}` 占位符换成固定路径（fake 不碰文件系统，任何字符串都行）。 */
function expandTmp(v: unknown): unknown {
  if (typeof v === 'string') return v.replaceAll('${TMP}', TMP);
  if (Array.isArray(v)) return v.map(expandTmp);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, expandTmp(x)]));
  }
  return v;
}

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

describe('payload contract (fakeBackend)', () => {
  it('sample table covers the whole fake registry and vice versa', () => {
    const sampled = new Set(Object.keys(doc.commands));
    const registered = new Set(backend.registeredCommands.filter((c) => c.startsWith('reflect_')));
    const missingSamples = [...registered].filter((c) => !sampled.has(c)).sort();
    const staleSamples = [...sampled].filter((c) => !registered.has(c)).sort();
    expect(missingSamples, 'fakeBackend 注册了但 payloads.json 没有样本').toEqual([]);
    expect(staleSamples, 'payloads.json 有样本但 fakeBackend 没注册').toEqual([]);
  });

  const entries = Object.entries(doc.commands).sort(([a], [b]) => a.localeCompare(b));
  it.each(entries)('%s accepts the real-backend payload shape', async (cmd, args) => {
    const expanded = expandTmp(args) as Record<string, unknown>;
    let result: unknown;
    await expect(
      (async () => {
        result = await invoke(cmd, expanded);
      })(),
      `${cmd} 的 fake handler 拒绝了真后端形状的参数 ${JSON.stringify(expanded)}`,
    ).resolves.toBeUndefined();
    // 返回值必须可经线格式序列化（undefined 等价于真后端的 `()`）。
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(backend.lastArgsOf(cmd)).toEqual(expanded);
  });
});
