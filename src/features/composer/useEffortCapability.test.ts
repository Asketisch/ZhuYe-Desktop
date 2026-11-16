import { describe, expect, it } from 'vitest';
import { toCapabilityView } from './useEffortCapability';

describe('思考强度能力视图', () => {
  it('已知能力只暴露模型支持的档位', () => {
    const view = toCapabilityView({
      model: 'openai/qwen3-max',
      supported: ['low', 'medium', 'high'],
      known: true,
      requested: 'ultra',
      effective: 'high',
      adjusted: true,
    });
    expect(view.options).toEqual(['low', 'medium', 'high']);
    expect(view.requested).toBe('ultra');
    expect(view.effective).toBe('high');
    expect(view.adjusted).toBe(true);
  });

  it('能力未知时展示全部档位并标明未知', () => {
    const view = toCapabilityView({
      model: 'openai/private-model',
      supported: [],
      known: false,
      requested: 'max',
      effective: 'max',
      adjusted: false,
    });
    expect(view.options).toEqual(['low', 'medium', 'high', 'max', 'ultra']);
    expect(view.known).toBe(false);
  });

  it('明确不支持思考参数时不提供可选档位', () => {
    const view = toCapabilityView({
      model: 'anthropic/claude-sonnet-5',
      supported: [],
      known: true,
      requested: 'high',
      effective: null,
      adjusted: true,
    });
    expect(view.options).toEqual([]);
    expect(view.effective).toBeNull();
  });

  it('无快照时回落到全部档位', () => {
    const view = toCapabilityView(undefined);
    expect(view.known).toBe(false);
    expect(view.options).toHaveLength(5);
  });
});
