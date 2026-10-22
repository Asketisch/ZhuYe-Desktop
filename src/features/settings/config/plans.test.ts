import { describe, expect, it } from 'vitest';
import {
  listPlans,
  maskKey,
  readContextWindowForModel,
  setContextWindowForModel,
  pickFailoverProvider,
  providerHasUsablePlan,
  readActiveProvider,
  removePlan,
  setActiveProvider,
  upsertPlan,
  type PlanEntry,
} from './plans';

const SAMPLE = `
[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top-anthropic"
model = "claude-sonnet-4"

[[anthropic.credentials]]
label = "glm-plan"
api_key = "sk-glm-1234"
base_url = "https://open.bigmodel.cn/api/anthropic"
weight = 2
quota = { window_secs = 3600, max_tokens = 120000, check_via = "zhipu" }

[[anthropic.credentials]]
label = "kimi-plan"
api_key = "sk-kimi-5678"

[anthropic.credentials.quota]
window_secs = 7200
max_tokens = 500000
check_via = "kimi"

[openai]
api_key = "sk-top-openai"
`;

describe('listPlans', () => {
  it('解析顶层隐式 plan 与 credentials 数组条目(内联 + 子表 quota 两种形式)', () => {
    const plans = listPlans(SAMPLE);
    expect(plans.map((p) => `${p.provider}/${p.label}`)).toEqual([
      'anthropic/default',
      'anthropic/glm-plan',
      'anthropic/kimi-plan',
      'openai/default',
    ]);
    const glm = plans[1];
    expect(glm.topLevel).toBe(false);
    expect(glm.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(glm.weight).toBe('2');
    expect(glm.quota).toEqual({ checkVia: 'zhipu', windowSecs: '3600', maxTokens: '120000' });
    // 子表形式的 quota 同样能解析。
    expect(plans[2].quota).toEqual({ checkVia: 'kimi', windowSecs: '7200', maxTokens: '500000' });
  });

  it('空配置返回空列表', () => {
    expect(listPlans('')).toEqual([]);
  });
});

describe('readActiveProvider / setActiveProvider', () => {
  it('读取与覆盖默认供应商', () => {
    expect(readActiveProvider(SAMPLE)).toBe('anthropic');
    const next = setActiveProvider(SAMPLE, 'openai');
    expect(readActiveProvider(next)).toBe('openai');
    // 其余内容保持不变。
    expect(next).toContain('label = "glm-plan"');
  });
});

describe('upsertPlan / removePlan', () => {
  it('追加新 plan 块并可再次更新(就地替换,不产生重复块)', () => {
    const added = upsertPlan(SAMPLE, {
      provider: 'openai',
      topLevel: false,
      label: 'minimax-plan',
      apiKey: 'sk-mm',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'MiniMax-M2',
      weight: '',
      quota: { checkVia: 'minimax', windowSecs: '86400', maxTokens: '1000000' },
    });
    expect(added).toContain('[[openai.credentials]]');
    expect(added).toContain('check_via = "minimax"');
    // 更新:改 model,块数量不变。
    const target: PlanEntry = {
      provider: 'openai',
      topLevel: false,
      label: 'minimax-plan',
      apiKey: 'sk-mm2',
      baseUrl: '',
      model: 'MiniMax-Text-01',
      weight: '',
      quota: null,
    };
    const updated = upsertPlan(added, target);
    expect(updated.match(/\[\[openai\.credentials\]\]/g)).toHaveLength(1);
    expect(updated).toContain('api_key = "sk-mm2"');
    expect(updated).toContain('model = "MiniMax-Text-01"');
    expect(updated).not.toContain('check_via = "minimax"');
    // 原 anthropic 块不受影响。
    expect(updated).toContain('label = "glm-plan"');
  });

  it('更新带子表 quota 的块时一并替换为内联形式', () => {
    const updated = upsertPlan(SAMPLE, {
      provider: 'anthropic',
      topLevel: false,
      label: 'kimi-plan',
      apiKey: 'sk-kimi-5678',
      baseUrl: '',
      model: '',
      weight: '',
      quota: { checkVia: 'zenmux', windowSecs: '60', maxTokens: '1000' },
    });
    expect(updated.match(/\[\[anthropic\.credentials\]\]/g)).toHaveLength(2);
    expect(updated).not.toContain('[anthropic.credentials.quota]');
    expect(updated).toContain('check_via = "zenmux"');
  });

  it('单引号 label 的块可被 removePlan 精确定位(不误删顶层 api_key)', () => {
    const singleQuoted = SAMPLE.replace('label = "glm-plan"', "label = 'glm-plan'");
    const next = removePlan(singleQuoted, 'anthropic', 'glm-plan');
    // 目标块被删,顶层隐式 default plan 不受牵连。
    expect(next).not.toContain('sk-glm-1234');
    expect(next).toContain('api_key = "sk-top-anthropic"');
  });

  it('数字形 api_key / 非数字 weight 的 TOML 往返保持合法', () => {
    const next = upsertPlan(SAMPLE, {
      provider: 'openai',
      topLevel: false,
      label: 'num',
      apiKey: '12345678',
      baseUrl: '',
      model: '',
      weight: 'high', // 手写 `weight = "high"` 的往返输入,后端 u32 不认
      quota: { checkVia: 'kimi', windowSecs: '5h', maxTokens: '' }, // 非数字 window
    });
    // 数字形字符串必须保持引号(裸写为 TOML 整型会被 serde 拒绝)。
    // 只检查新追加的 openai 块 —— SAMPLE 里既有块含合法 weight = 2。
    const block = next.slice(next.indexOf('[[openai.credentials]]'));
    expect(block).toContain('api_key = "12345678"');
    // 非数字 weight / 半截 quota 不写入(weight 回落默认 1,quota 不声明)。
    expect(block).not.toMatch(/^weight\s*=/m);
    expect(block).not.toContain('window_secs = 5h');
    expect(block).toContain('label = "num"');
  });

  it('应用序列化的 credentials = [] 必须先剥离再追加(否则保存被后端拒绝)', () => {
    // `toml::to_string_pretty` 把空 Vec 写成内联 `credentials = []`;
    // TOML 不允许同 key 既是普通数组又被 [[...]] 扩展 —— 不剥离的话
    // reflect_save_config 的 load_from_str 拒绝整份配置。
    const serialized = `[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top"
base_url = "https://api.stepfun.com/step_plan"
model = "step-3.7-flash"
timeout_secs = 300
credentials = []
`;
    const next = upsertPlan(serialized, {
      provider: 'anthropic',
      topLevel: false,
      label: 'glm',
      apiKey: 'sk-glm',
      baseUrl: '',
      model: 'glm-4.6',
      weight: '',
      quota: null,
    });
    expect(next).not.toMatch(/^credentials\s*=\s*\[\s*\]/m);
    expect(next).toContain('[[anthropic.credentials]]');
    expect(next).toContain('label = "glm"');
    // 回读闭环:隐式 default + 新 plan 都可见。
    expect(listPlans(next).map((p) => p.label)).toEqual(['default', 'glm']);
    // 其他段的 credentials = [] 不受牵连(只剥目标 provider 段)。
    const withOpenai = upsertPlan(`${serialized}[openai]\napi_key = "k"\ncredentials = []\n`, {
      provider: 'anthropic',
      topLevel: false,
      label: 'glm2',
      apiKey: 'sk-g2',
      baseUrl: '',
      model: '',
      weight: '',
      quota: null,
    });
    expect(withOpenai).toMatch(/^credentials = \[\]/m); // openai 段的保留
  });

  it('topLevel plan 写回 [provider] 段', () => {
    const next = upsertPlan(SAMPLE, {
      provider: 'openai',
      topLevel: true,
      label: 'default',
      apiKey: 'sk-new-top',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
      weight: '',
      quota: null,
    });
    expect(next).toContain('api_key = "sk-new-top"');
    expect(next).not.toContain('sk-top-openai');
    expect(readActiveProvider(next)).toBe('anthropic');
  });

  it('removePlan 删除数组块(含子表),topLevel 删除 api_key', () => {
    const removed = removePlan(SAMPLE, 'anthropic', 'glm-plan');
    expect(removed).not.toContain('glm-plan');
    expect(removed).toContain('label = "kimi-plan"');
    const removedTop = removePlan(SAMPLE, 'openai', 'default');
    expect(removedTop).not.toContain('sk-top-openai');
  });
});

describe('pickFailoverProvider', () => {
  it('跳过耗尽的 provider,挑第一个有可用 plan 的', () => {
    expect(pickFailoverProvider(SAMPLE, 'anthropic')).toBe('openai');
  });

  it('failover 只在两种接入端口间选择（anthropic / openai）', () => {
    expect(pickFailoverProvider(SAMPLE, 'openai')).toBe('anthropic');
    expect(pickFailoverProvider('', 'anthropic')).toBeNull();
  });

  it('无候选时返回 null', () => {
    // 只配置了一个 provider 的配置,该 provider 耗尽后无候选。
    const single = '[openai]\napi_key = "sk-o"\n';
    expect(pickFailoverProvider(single, 'openai')).toBeNull();
    expect(pickFailoverProvider(SAMPLE, 'nonexistent')).toBe('anthropic');
  });
});

describe('context_windows (plan 最大上下文)', () => {
  it('写入 [context_windows] quoted key 并可读回', () => {
    const next = setContextWindowForModel(SAMPLE, 'glm-4.7', '200000');
    expect(next).toContain('[context_windows]');
    expect(next).toContain('"glm-4.7" = 200000');
    expect(readContextWindowForModel(next, 'glm-4.7')).toBe('200000');
    // 含点号的模型名也能读。
    expect(readContextWindowForModel(next, 'glm-4.7')).toBe('200000');
  });

  it('空串清除覆盖;未设置返回空', () => {
    let next = setContextWindowForModel(SAMPLE, 'glm-4.7', '128000');
    next = setContextWindowForModel(next, 'glm-4.7', '');
    expect(readContextWindowForModel(next, 'glm-4.7')).toBe('');
    expect(readContextWindowForModel(SAMPLE, 'unset-model')).toBe('');
  });

  it('手写 bare 键不产生 duplicate key(写入前两种形式都清除)', () => {
    const withBare = `${SAMPLE}\n[context_windows]\nmodel-x = 123456\n`;
    const next = setContextWindowForModel(withBare, 'model-x', '200000');
    // bare 旧键被摘除,只剩 quoted 新键 —— 否则后端 load_from_str 拒绝整份配置。
    expect(next).not.toMatch(/^model-x\s*=/m);
    expect(next.match(/["']?model-x["']?\s*=/g)).toHaveLength(1);
    expect(readContextWindowForModel(next, 'model-x')).toBe('200000');
    // 空串 = 清除 bare 既有键。
    const cleared = setContextWindowForModel(withBare, 'model-x', '');
    expect(cleared).not.toMatch(/^model-x\s*=/m);
    expect(readContextWindowForModel(cleared, 'model-x')).toBe('');
  });
});

describe('maskKey', () => {
  it('保留末 4 位', () => {
    expect(maskKey('sk-abcdef1234')).toBe('••••1234');
    expect(maskKey('abc')).toBe('••••');
  });
});

describe('免 Key 端点(免费模型池)', () => {
  const KEYLESS = `
[active]
provider = "openai"

[openai]
api_key = ""
base_url = "https://api.kilo.ai/api/gateway"
model = "free"

[[openai.credentials]]
label = "kilo-free"
base_url = "https://api.kilo.ai/api/gateway"
model = "free"
`;

  it('顶层免 Key 形态(api_key="" + base_url)也出现在 plan 列表里', () => {
    // 此前只看 api_key 非空 → 这条 plan 整条从列表消失(用户看不到也删不掉),
    // 而它恰恰是运行时真正生效的那条凭证。
    const plans = listPlans(KEYLESS);
    expect(plans.map((p) => `${p.provider}/${p.label}`)).toEqual([
      'openai/default',
      'openai/kilo-free',
    ]);
    expect(plans[0].apiKey).toBe('');
    expect(plans[0].baseUrl).toBe('https://api.kilo.ai/api/gateway');
    expect(plans[1].apiKey).toBe('');
  });

  it('免 Key 的 plan 仍算「可用」(否则永远不被选作 failover 目标)', () => {
    expect(providerHasUsablePlan(KEYLESS, 'openai')).toBe(true);
  });

  it('删除顶层 plan 时连 base_url 一起删(否则留下一个仍会注册的免 Key provider)', () => {
    const removed = removePlan(KEYLESS, 'openai', 'default');
    // 只看 `[openai]` 段本身 —— 数组条目(kilo-free)有自己的 base_url,不受影响。
    const topSection = removed.slice(removed.indexOf('[openai]'), removed.indexOf('[['));
    expect(topSection).not.toContain('base_url');
    expect(topSection).not.toContain('api_key');
    // model 只是模型名,不是凭据 —— 保留。
    expect(removed).toContain('model = "free"');
    expect(listPlans(removed).filter((p) => p.topLevel)).toHaveLength(0);
  });

  it('写入免 Key 的数组条目时不写 api_key 行(缺省 = 空串 = 免 Key)', () => {
    const toml = upsertPlan(KEYLESS, {
      provider: 'openai',
      topLevel: false,
      label: 'kilo-free-2',
      apiKey: '',
      baseUrl: 'https://api.kilo.ai/api/gateway',
      model: 'free',
      weight: '',
      quota: null,
    });
    const block = toml.slice(toml.indexOf('[[openai.credentials]]'));
    expect(block).toContain('label = "kilo-free-2"');
    expect(block).not.toContain('api_key');
  });
});
