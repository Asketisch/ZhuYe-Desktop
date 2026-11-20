/**
 * Vitest — bridge fallback 测试。
 */
import { describe, it, expect } from 'vitest';
import { invoke, listen } from '@/utils/bridge';

describe('invoke', () => {
  it('returns the value from mocked handler', async () => {
    // test setup.tsx 默认注册了 'ping' mock；未注册时通过全局 mock 走 fallback
    const r = await invoke<{ msg: string }>('ping');
    expect(r).toEqual({ msg: 'pong', version: '0.1.0' });
  });

  it('does not throw on unmocked cmd in test env (mock throws synchronously to setup path)', async () => {
    // 注意：测试环境将 invoke() 包装为 mock，未 mock 的命令会抛错。
    // Bridge.ts 捕获非 Tauri 错误；mock 抛出 "[mock] invoke(...) not mocked"
    // 这不是 Tauri 错误 → 桥接层重新抛出。我们断言它会重新抛出。
    await expect(invoke('definitely_not_a_real_cmd_xyz')).rejects.toThrow();
  });
});

describe('listen', () => {
  it('returns an unlisten function', async () => {
    const unlisten = await listen<string>('zhuye_event', () => {});
    expect(typeof unlisten).toBe('function');
    expect(() => unlisten()).not.toThrow();
  });
});