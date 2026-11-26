/**
 * autoCompact 控制器单元测试 —— 依赖注入,不触碰 zustand / Tauri IPC。
 *
 * 覆盖:阈值触发(默认 85%)、组级 auto_compact 覆盖、触发闩(压缩后
 * 不连环)、回落复位、节流、max_context 解析([context_windows][model],
 * 段级 model 覆盖优先)、会话窗口兜底。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_TRIGGER_RATIO, createAutoCompactController } from './autoCompact';

const TOML = `[active]
group = "openai"

[[model_group]]
id = "openai"
api_key = "sk-1"
model = "glm-4.7"

[context_windows]
"glm-4.7" = 100000
`;

function makeController(overrides?: { toml?: string; compact?: () => Promise<unknown> }) {
  const compacts: number[] = [];
  const controller = createAutoCompactController({
    getConfig: async () => overrides?.toml ?? TOML,
    compact: async () => {
      compacts.push(compacts.length + 1);
      return overrides?.compact ? overrides.compact() : null;
    },
  });
  return { controller, compacts };
}

describe('autoCompact controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tick = () => vi.advanceTimersByTimeAsync(31_000);

  it(`输入达到 max_context 的 ${DEFAULT_TRIGGER_RATIO * 100}%（默认阈值）时触发一次压缩`, async () => {
    const { controller, compacts } = makeController();
    await controller(84_000); // < 100000 × 0.85 → 不触发
    expect(compacts).toHaveLength(0);
    await tick();
    await controller(85_000); // ≥ 100000 × 0.85 → 触发
    expect(compacts).toHaveLength(1);
  });

  it('组级 auto_compact 覆盖默认阈值', async () => {
    // 注意 auto_compact 必须写在 [[model_group]] 块内（[context_windows]
    // 表头会切断组作用域）。
    const { controller, compacts } = makeController({
      toml: `[active]
group = "openai"

[[model_group]]
id = "openai"
api_key = "sk-1"
model = "glm-4.7"
auto_compact = 0.6

[context_windows]
"glm-4.7" = 100000
`,
    });
    await controller(55_000); // < 100000 × 0.6 → 不触发
    expect(compacts).toHaveLength(0);
    await tick();
    await controller(60_000); // ≥ 100000 × 0.6 → 触发
    expect(compacts).toHaveLength(1);
  });

  it('触发后有闩:同窗口不连环压缩,回落 50% 以下重新武装', async () => {
    const { controller, compacts } = makeController();
    await controller(90_000);
    expect(compacts).toHaveLength(1);
    await tick();
    await controller(88_000); // 闩未复位,不触发
    expect(compacts).toHaveLength(1);
    await tick();
    await controller(40_000); // < 50% → 复位
    await tick();
    await controller(95_000); // 再次越线 → 再触发
    expect(compacts).toHaveLength(2);
  });

  it('30s 节流窗口内的重复 token_count 不重复解析 config', async () => {
    const { controller, compacts } = makeController();
    await controller(99_000);
    await controller(99_500); // 节流窗口内直接忽略
    expect(compacts).toHaveLength(1);
  });

  it('未设置 [context_windows] 且无会话窗口时不触发', async () => {
    const { controller, compacts } = makeController({
      toml: '[active]\ngroup = "openai"\n\n[[model_group]]\nid = "openai"\napi_key = "sk-1"\nmodel = "glm-4.7"\n',
    });
    await controller(999_999);
    expect(compacts).toHaveLength(0);
  });

  it('使用实际调用模型的窗口，而非默认模型窗口', async () => {
    const { controller, compacts } = makeController({
      toml: `${TOML}\n"other" = 20000\n`,
    });
    await controller(17_000, 'openai/other'); // ≥ 20000 × 0.85 = 17000
    expect(compacts).toHaveLength(1);
  });

  it('无模型配置时使用会话上报的上下文窗口（同样按默认 85% 阈值）', async () => {
    const { controller, compacts } = makeController({ toml: '[active]\ngroup = "openai"\n' });
    await controller(9_000, 'unknown', 10_000); // ≥ 10000 × 0.85 = 8500
    expect(compacts).toHaveLength(1);
  });

  it('compact 抛错时闩复位,允许重试', async () => {
    const { controller, compacts } = makeController({
      compact: async () => {
        throw new Error('backend busy');
      },
    });
    await controller(90_000);
    expect(compacts).toHaveLength(1);
    await tick();
    await controller(91_000); // 闩已复位(失败),再次触发
    expect(compacts).toHaveLength(2);
  });
});
