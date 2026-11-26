/**
 * Vitest —— 跨模型组自动 failover。
 *
 * 新契约：候选目标来自 `[[model_group]]`（组 id 即接入目标），切换写
 * `[active].group`。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_FAILOVER_PREF_KEY,
  createPlanFailoverController,
  extractExhaustionSignal,
  FAILOVER_DEBOUNCE_MS,
  type PlanFailoverDeps,
} from './planFailover';

function makeDeps(overrides: Partial<PlanFailoverDeps> = {}) {
  const calls: { toasts: Array<{ kind: string; message: string }>; saved: string[]; switched: Array<[string, string]> } = {
    toasts: [],
    saved: [],
    switched: [],
  };
  const deps: PlanFailoverDeps = {
    getConfig: vi.fn(async () => CONFIG_TWO_GROUPS),
    saveConfig: vi.fn(async (toml: string) => {
      calls.saved.push(toml);
    }),
    pushToast: vi.fn((input: { kind: string; message: string }) => {
      calls.toasts.push(input);
    }),
    isEnabled: () => true,
    onSwitched: (from, to) => calls.switched.push([from, to]),
    currentGroup: () => 'demo',
    ...overrides,
  };
  return { deps, calls };
}

const CONFIG_TWO_GROUPS = `
[active]
group = "demo"

[[model_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
api_key = "sk-a"
model = "demo/model-a"

[[model_group.credentials]]
label = "glm"
api_key = "sk-glm"
quota = { window_secs = 3600, max_tokens = 1000 }

[[model_group]]
id = "backup"
label = "备用网关"
endpoint = "openai"
api_key = "sk-b"
model = "backup/model-b"
`;

describe('extractExhaustionSignal', () => {
  it('quota_exhausted 事件直接判定为耗尽', () => {
    const signal = extractExhaustionSignal(
      { type: 'quota_exhausted', provider: 'demo', label: 'glm', message: 'window exhausted' },
      'demo',
    );
    expect(signal).toEqual({
      group: 'demo',
      label: 'glm',
      reason: 'window exhausted',
    });
  });

  it('error 事件命中耗尽特征文本才判定(组 id 取自 details)', () => {
    const signal = extractExhaustionSignal(
      {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'ALL_CREDENTIALS_EXHAUSTED',
        details: '{"provider":"demo","tried":[]}',
      },
      'demo',
    );
    expect(signal).not.toBeNull();
    expect(signal!.group).toBe('demo');
  });

  it('普通 error(网络/认证)不判定为耗尽', () => {
    expect(
      extractExhaustionSignal({ type: 'error', code: 'AUTH_FAILED', message: 'invalid api key' }, 'demo'),
    ).toBeNull();
    expect(
      extractExhaustionSignal({ type: 'error', code: 'NETWORK', message: 'connection reset' }, 'demo'),
    ).toBeNull();
    expect(extractExhaustionSignal({ type: 'stream_error' }, 'demo')).toBeNull();
  });
});

describe('createPlanFailoverController', () => {
  afterEach(() => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
    vi.restoreAllMocks();
  });

  it('耗尽时切换到备用模型组并落盘 + toast + 记录', async () => {
    const { deps, calls } = makeDeps();
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.saved).toHaveLength(1);
    // 组 id 才是切换目标 —— 写 [active].group。
    expect(calls.saved[0]).toContain('group = "backup"');
    expect(calls.switched).toEqual([['demo', 'backup']]);
    expect(calls.toasts[0].kind).toBe('success');
  });

  it('无备用模型组时只弹提示,不改配置', async () => {
    const { deps, calls } = makeDeps({
      getConfig: vi.fn(async () => '[[model_group]]\nid = "demo"\napi_key = "sk-a"\n'),
    });
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.saved).toHaveLength(0);
    expect(calls.toasts[0].kind).toBe('error');
    expect(calls.switched).toEqual([]);
  });

  it('无凭据的组不会被选作备用目标', async () => {
    const { deps, calls } = makeDeps({
      getConfig: vi.fn(async () =>
        '[active]\ngroup = "demo"\n\n[[model_group]]\nid = "demo"\napi_key = "sk-a"\n\n[[model_group]]\nid = "empty"\nlabel = "空组"\n',
      ),
    });
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.saved).toHaveLength(0);
    expect(calls.toasts[0].kind).toBe('error');
  });

  it('防抖窗口内不重复切换', async () => {
    vi.useFakeTimers();
    try {
      const { deps, calls } = makeDeps();
      const controller = createPlanFailoverController(deps);
      await controller.handle({ group: 'demo', reason: 'quota' });
      expect(calls.saved).toHaveLength(1);
      // 同一防抖窗口内再次耗尽 → 不切换。
      await controller.handle({ group: 'backup', reason: 'quota' });
      expect(calls.saved).toHaveLength(1);
      // 超过防抖窗口后可再次切换。
      vi.setSystemTime(Date.now() + FAILOVER_DEBOUNCE_MS + 1);
      await controller.handle({ group: 'demo', reason: 'quota' });
      expect(calls.saved).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('开关关闭时不做任何事', async () => {
    const { deps, calls } = makeDeps({ isEnabled: () => false });
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.saved).toHaveLength(0);
    expect(calls.toasts).toHaveLength(0);
  });

  it('reset 清空防抖状态', async () => {
    const { deps, calls } = makeDeps();
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    controller.reset();
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.saved).toHaveLength(2);
  });

  it('config 保存失败时弹错误提示', async () => {
    const { deps, calls } = makeDeps({
      saveConfig: vi.fn(async () => {
        throw new Error('validation failed');
      }),
    });
    const controller = createPlanFailoverController(deps);
    await controller.handle({ group: 'demo', reason: 'quota' });
    expect(calls.toasts[0].kind).toBe('error');
    expect(calls.switched).toEqual([]);
  });

  it('isAutoFailoverEnabled:缺省开启,localStorage 设 off 后关闭', async () => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
    const { isAutoFailoverEnabled } = await import('./planFailover');
    expect(isAutoFailoverEnabled()).toBe(true);
    localStorage.setItem(AUTO_FAILOVER_PREF_KEY, 'off');
    expect(isAutoFailoverEnabled()).toBe(false);
  });
});
