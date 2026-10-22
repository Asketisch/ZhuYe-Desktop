/**
 * 性能预算(冒烟级) —— 大数据量下的关键路径墙钟上限。
 *
 * 不是基准测试:阈值取得很宽(本地实测的数十倍),只在出现**数量级级**
 * 回归(如某次改动让 reducer 变成 O(n²)、分桶遍历被放大)时变红。
 * `PERF_STRICT=1` 收紧到本地实测的 ~10 倍,供性能敏感迭代时本地使用。
 *
 * 预算对象:
 *   - `reduceEvent`:1 万条 agent_message_delta 的纯 reducer 累积
 *     (流式回复的核心热路径;实测 ~2ms/万条);
 *   - `bucketSessions`:5 千会话的时间分桶(侧栏列表渲染前的分组);
 *   - 会话重放水合:2 千条记录的 rollout → /chat 路由渲染
 *     (真实挂载 + React Query + MessageList,长会话打开速度的代理指标)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { useAgentStore } from '@/stores/agentStore';
import { reduceEvent } from '@/stores/agent';
import { bucketSessions } from '@/features/sessions/utils/buckets';
import type { ReflectSessionInfo } from '@/utils/commands';

/** 宽松预算(默认,防数量级回归)/ 严格预算(PERF_STRICT=1,本地性能迭代用)。 */
const B = (loose: number, strict: number) => (process.env.PERF_STRICT === '1' ? strict : loose);

const DELTA_BUDGET_MS = B(1_000, 100); // 实测 ~2ms
const BUCKET_BUDGET_MS = B(1_000, 100); // 实测 <10ms
const REPLAY_RENDER_BUDGET_MS = B(30_000, 8_000); // jsdom 下 2k 记录挂载,实测秒级内

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

describe('perf budgets', () => {
  it(`reduceEvent: 10k deltas within ${DELTA_BUDGET_MS}ms`, () => {
    useAgentStore.getState().reset();
    type S = Parameters<typeof reduceEvent>[0];
    let state = useAgentStore.getState() as S;
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      const partial = reduceEvent(state, {
        id: 'perf-turn',
        msg: { type: 'agent_message_delta', delta: `chunk-${i} ` },
      });
      state = { ...state, ...partial } as S;
    }
    const elapsed = performance.now() - t0;
    expect(
      elapsed,
      `reduceEvent 10k 条 delta 用了 ${elapsed.toFixed(1)}ms(预算 ${DELTA_BUDGET_MS}ms)—— 流式热路径出现数量级回归`,
    ).toBeLessThan(DELTA_BUDGET_MS);
  });

  it(`bucketSessions: 5k sessions within ${BUCKET_BUDGET_MS}ms`, () => {
    const sessions = Array.from({ length: 5_000 }, (_, i) => ({
      session_id: `perf-s-${i}`,
      thread_id: `perf-t-${i}`,
      model: 'probe/model',
      provider: 'local',
      started_at: new Date(Date.now() - Math.random() * 30 * 86_400_000).toISOString(),
      message_count: i,
      tool_count: 0,
      token_total: 0,
      cwd: '/tmp',
      display_name: null,
    })) as unknown as ReflectSessionInfo[];
    const t0 = performance.now();
    const buckets = bucketSessions(sessions);
    const elapsed = performance.now() - t0;
    expect(buckets.length).toBe(5);
    expect(
      elapsed,
      `bucketSessions 5k 会话用了 ${elapsed.toFixed(1)}ms(预算 ${BUCKET_BUDGET_MS}ms)`,
    ).toBeLessThan(BUCKET_BUDGET_MS);
  });

  it(`/chat hydration: 2k-record rollout renders within ${REPLAY_RENDER_BUDGET_MS}ms`, async () => {
    // 1000 轮 × (user + assistant) = 2000 条记录的长会话。
    const records: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1_000; i += 1) {
      records.push({
        type: 'message',
        turn_id: `perf-turn-${i}`,
        role: 'user',
        content: `性能预算探针问题 #${i}`,
      });
      records.push({
        type: 'message',
        turn_id: `perf-turn-${i}`,
        role: 'assistant',
        content: [
          { type: 'text', text: `性能预算探针回答 #${i}:这是一段用于测量的固定长度文本。` },
        ],
      });
    }
    backend.state.rollouts['sess-alpha'] = records;

    const app = renderApp();
    const t0 = performance.now();
    await app.navigate('/chat/sess-alpha');
    await waitFor(
      () => {
        expect(document.querySelector('main')?.textContent).toContain('性能预算探针回答 #999');
      },
      { timeout: REPLAY_RENDER_BUDGET_MS },
    );
    const elapsed = performance.now() - t0;
    expect(
      elapsed,
      `2k 记录会话的水合 + 渲染用了 ${elapsed.toFixed(0)}ms(预算 ${REPLAY_RENDER_BUDGET_MS}ms)—— 长会话打开出现数量级回归`,
    ).toBeLessThan(REPLAY_RENDER_BUDGET_MS);
  }, REPLAY_RENDER_BUDGET_MS + 20_000);
});
