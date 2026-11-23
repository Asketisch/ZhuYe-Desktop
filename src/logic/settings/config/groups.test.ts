/**
 * Vitest — groups.ts 纯 TOML 手术的单测。
 *
 * 覆盖:解析([[model_group]] 条目 + 组内 credentials)、旧键
 * [[provider_group]] 兼容读入、[active].group 读写(含旧键 alias 清理)、
 * upsert(新增/更新/嵌套凭据写回)、remove(整组归属含 credentials)、
 * id 校验(保留名/'/'/歧义字符)、数值字段往返、凭据可用性判定。
 */
import { describe, expect, it } from 'vitest';
import {
  groupDisplayLabel,
  groupHasUsableCredential,
  isValidGroupId,
  listGroups,
  readActiveGroup,
  readContextWindows,
  readDefaultEffort,
  removeGroup,
  setActiveGroup,
  setDefaultEffort,
  setGroupContextWindow,
  upsertGroup,
  type GroupEntry,
} from './groups';

const SAMPLE_TOML = `[active]
group = "demo"

[[model_group]]
id = "bigmodel"
label = "智谱 GLM"
endpoint = "openai"
base_url = "https://open.bigmodel.cn/api/paas/v4"
api_key = "sk-glm"
model = "GLM-5.3-Flash"
responses_api = true
timeout_secs = 120
temperature = 0.7
max_tokens = 8192

[[model_group]]
id = "demo"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"

[[model_group.credentials]]
label = "backup"
api_key = "sk-backup"
model = "demo/model-a"
weight = 3
quota = { window_secs = 18000, max_tokens = 100000 }

[context_windows]
"GLM-5.3-Flash" = 200000
`;

/** 旧键（[[provider_group]]）—— 引擎读入时已迁移成 [[model_group]]，
 * 前端读入路径仍需兼容存量文件。 */
const LEGACY_TOML = `[active]
provider = "legacy"

[[provider_group]]
id = "legacy"
label = "旧组"
endpoint = "openai"
api_key = "sk-legacy"

[[provider_group.credentials]]
label = "old"
api_key = "sk-old"
`;

function emptyGroup(over: Partial<GroupEntry> = {}): GroupEntry {
  return {
    id: 'new-gw',
    label: '',
    endpoint: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    responsesApi: false,
    timeoutSecs: null,
    temperature: null,
    maxTokens: null,
    contextWindow: null,
    autoCompact: null,
    keepAliveSecs: null,
    numCtx: null,
    numGpu: null,
    credentials: [],
    ...over,
  };
}

describe('groups.ts 纯函数', () => {
  it('解析全部模型组条目(组内凭据归到所属组)', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 'bigmodel',
      label: '智谱 GLM',
      endpoint: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-glm',
      model: 'GLM-5.3-Flash',
      responsesApi: true,
      timeoutSecs: 120,
      temperature: 0.7,
      maxTokens: 8192,
    });
    expect(groups[0].credentials).toHaveLength(0);
    // 第二个组没有 api_key/model 字段 → 空串(免 Key 组)。
    expect(groups[1].id).toBe('demo');
    expect(groups[1].apiKey).toBe('');
    expect(groups[1].model).toBe('');
    expect(groups[1].timeoutSecs).toBeNull();
  });

  it('解析组内凭据(含权重与配额)', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(groups[1].credentials).toHaveLength(1);
    expect(groups[1].credentials[0]).toEqual({
      label: 'backup',
      apiKey: 'sk-backup',
      baseUrl: '',
      model: 'demo/model-a',
      weight: 3,
      quota: { windowSecs: 18000, maxTokens: 100000 },
    });
  });

  it('兼容读入旧键 [[provider_group]]', () => {
    const groups = listGroups(LEGACY_TOML);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'legacy', label: '旧组', endpoint: 'openai', apiKey: 'sk-legacy' });
    expect(groups[0].credentials).toHaveLength(1);
    expect(groups[0].credentials[0]).toMatchObject({ label: 'old', apiKey: 'sk-old' });
  });

  it('responses_api = true 解析为布尔', () => {
    const groups = listGroups('[[model_group]]\nid = "x"\nendpoint = "openai"\nresponses_api = true\n');
    expect(groups[0].responsesApi).toBe(true);
  });

  it('isValidGroupId 拒绝空 / "/" / 歧义字符 / 引擎保留名', () => {
    expect(isValidGroupId('bigmodel')).toBe(true);
    expect(isValidGroupId('my-glm_2')).toBe(true);
    // 旧内置段名不再保留 —— 引擎把它们迁移成同名模型组。
    expect(isValidGroupId('anthropic')).toBe(true);
    expect(isValidGroupId('openai')).toBe(true);
    expect(isValidGroupId('ollama')).toBe(true);
    expect(isValidGroupId('')).toBe(false);
    expect(isValidGroupId('  ')).toBe(false);
    expect(isValidGroupId('a/b')).toBe(false);
    expect(isValidGroupId('a[b]')).toBe(false);
    expect(isValidGroupId('a]b')).toBe(false);
    expect(isValidGroupId('mock')).toBe(false);
  });

  it('groupDisplayLabel:显式 label 优先,缺省回退 id', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(groupDisplayLabel(groups[0])).toBe('智谱 GLM');
    expect(groupDisplayLabel(groups[1])).toBe('demo');
  });

  it('readActiveGroup:读 [active].group,旧键 [active].provider 同样认', () => {
    expect(readActiveGroup(SAMPLE_TOML)).toBe('demo');
    expect(readActiveGroup(LEGACY_TOML)).toBe('legacy');
    expect(readActiveGroup('[active]\n')).toBe('');
  });

  it('setActiveGroup:写 [active].group 并清掉旧键 provider(避免引擎 duplicate field)', () => {
    const next = setActiveGroup(SAMPLE_TOML, 'bigmodel');
    expect(readActiveGroup(next)).toBe('bigmodel');
    expect(next).toContain('group = "bigmodel"');
    expect(next).not.toContain('provider = ');
    // 旧键文件同样被清理。
    const migrated = setActiveGroup(LEGACY_TOML, 'other');
    expect(migrated).toContain('group = "other"');
    expect(migrated).not.toContain('provider = ');
  });

  it('setActiveGroup:配置里没有 [active] 段时自动建段', () => {
    const next = setActiveGroup('[[model_group]]\nid = "x"\n', 'x');
    expect(next).toContain('[active]');
    expect(readActiveGroup(next)).toBe('x');
  });

  it('upsertGroup 新组追加到已有组的归属块之后(组条目保持相邻)', () => {
    const next = upsertGroup(SAMPLE_TOML, emptyGroup({ baseUrl: 'https://gw.example.com' }));
    expect(next).toContain('[[model_group]]\nid = "new-gw"');
    // 后续段([context_windows])仍在,且新组条目先于它。
    expect(next).toContain('[context_windows]');
    expect(next.indexOf('id = "new-gw"')).toBeLessThan(next.indexOf('[context_windows]'));
  });

  it('upsertGroup 写入组内凭据的嵌套表', () => {
    const next = upsertGroup('', emptyGroup({
      id: 'with-creds',
      baseUrl: 'https://gw.example.com',
      credentials: [
        { label: 'main', apiKey: 'sk-main', baseUrl: '', model: 'm1', weight: 2, quota: null },
        {
          label: 'backup',
          apiKey: 'sk-backup',
          baseUrl: '',
          model: 'm2',
          weight: 1,
          quota: { windowSecs: 18000, maxTokens: 100000 },
        },
      ],
    }));
    expect(next).toContain('[[model_group.credentials]]');
    expect(next).toContain('label = "main"');
    expect(next).toContain('weight = 2');
    expect(next).toContain('quota = { window_secs = 18000, max_tokens = 100000 }');
    // 往返一致。
    const groups = listGroups(next);
    expect(groups[0].credentials).toHaveLength(2);
    expect(groups[0].credentials[1].quota).toEqual({ windowSecs: 18000, maxTokens: 100000 });
  });

  it('upsertGroup 更新既有组:整段替换(含组内凭据)', () => {
    const next = upsertGroup(SAMPLE_TOML, emptyGroup({
      id: 'demo',
      label: '示例网关',
      endpoint: 'anthropic',
      baseUrl: 'http://127.0.0.1:9999',
      model: 'demo/model-a',
      timeoutSecs: 60,
    }));
    expect(next).toContain('base_url = "http://127.0.0.1:9999"');
    expect(next).toContain('model = "demo/model-a"');
    expect(next).toContain('timeout_secs = 60');
    // 凭据由 GUI 一并托管 —— 更新后按表单内容重写。
    expect(next).not.toContain('[[model_group.credentials]]');
    const groups = listGroups(next);
    expect(groups[1]).toMatchObject({ id: 'demo', baseUrl: 'http://127.0.0.1:9999', model: 'demo/model-a' });
    expect(groups[1].credentials).toHaveLength(0);
  });

  it('数值字段往返(timeout / temperature / max_tokens / ollama 三项)', () => {
    const next = upsertGroup('', emptyGroup({
      id: 'nums',
      timeoutSecs: 45,
      temperature: 0.25,
      maxTokens: 1024,
      keepAliveSecs: 600,
      numCtx: 32768,
      numGpu: 99,
    }));
    expect(next).toContain('timeout_secs = 45');
    expect(next).toContain('temperature = 0.25');
    expect(next).toContain('max_tokens = 1024');
    expect(next).toContain('keep_alive_secs = 600');
    expect(next).toContain('num_ctx = 32768');
    expect(next).toContain('num_gpu = 99');
    expect(listGroups(next)[0]).toMatchObject({
      timeoutSecs: 45,
      temperature: 0.25,
      maxTokens: 1024,
      keepAliveSecs: 600,
      numCtx: 32768,
      numGpu: 99,
    });
  });

  it('改名 = removeGroup(旧 id) + upsertGroup(新 id),不残留旧条目', () => {
    // GUI 编辑路径(与 GroupForm.onSaveGroup 一致):先摘旧块再写新块。
    const removed = removeGroup(SAMPLE_TOML, 'demo');
    const next = upsertGroup(removed, emptyGroup({ id: 'demo-v2', endpoint: 'anthropic' }));
    expect(next).not.toContain('id = "demo"');
    expect(listGroups(next).map((g) => g.id)).toEqual(['bigmodel', 'demo-v2']);
  });

  it('removeGroup 清除整组归属(含组内凭据)', () => {
    const next = removeGroup(SAMPLE_TOML, 'demo');
    expect(listGroups(next)).toHaveLength(1);
    expect(next).not.toContain('[[model_group.credentials]]');
    expect(next).not.toContain('label = "backup"');
    // 其他段不受影响。
    expect(next).toContain('id = "bigmodel"');
    expect(next).toContain('[context_windows]');
  });

  it('removeGroup 未知 id 原样返回', () => {
    expect(removeGroup(SAMPLE_TOML, 'ghost')).toBe(SAMPLE_TOML);
  });

  it('免 Key 组(无 api_key 行)解析与 upsert 往返一致', () => {
    const next = upsertGroup('', emptyGroup({ id: 'free-pool', baseUrl: 'https://free.example.test', model: 'm1' }));
    // api_key 为空 → 整行不写(引擎侧 Option 缺省,None 与 "" 同语义)。
    expect(next).not.toContain('api_key');
    expect(listGroups(next)[0]).toMatchObject({ id: 'free-pool', apiKey: '', model: 'm1' });
  });

  it('upsertGroup 对非法 id 原样返回(调用方先做 UI 校验)', () => {
    expect(upsertGroup(SAMPLE_TOML, emptyGroup({ id: 'a/b' }))).toBe(SAMPLE_TOML);
  });

  it('groupHasUsableCredential:组级 key 或任一凭据 key 非空即算可用', () => {
    const groups = listGroups(SAMPLE_TOML);
    // bigmodel 有组级 api_key。
    expect(groupHasUsableCredential(groups[0])).toBe(true);
    // demo 组级无 key,但有带 key 的组内凭据。
    expect(groupHasUsableCredential(groups[1])).toBe(true);
    expect(
      groupHasUsableCredential(
        emptyGroup({ apiKey: '', credentials: [{ label: 'a', apiKey: '', baseUrl: '', model: '', weight: 1, quota: null }] }),
      ),
    ).toBe(false);
  });
});

// ── [context_windows] / [model].reasoning_effort 读写 ──────────────────

describe('[context_windows] 表读写', () => {
  it('readContextWindows 解析顶层 kv(键小写化)', () => {
    const toml = [
      '[model_group_telemetry]', // 干扰段
      'x = 1',
      '',
      '[context_windows]',
      '"qwen3.8-27b-nvfp4" = 1000000',
      'glm-5 = 128000',
    ].join('\n');
    const w = readContextWindows(toml);
    expect(w['qwen3.8-27b-nvfp4']).toBe(1000000);
    expect(w['glm-5']).toBe(128000);
    expect(w['x']).toBeUndefined();
  });

  it('setGroupContextWindow 新建表 / 更新 / 删除键与空表摘除', () => {
    let toml = '[[model_group]]\nid = "openai"\n';
    // 新建表 + 键。
    toml = setGroupContextWindow(toml, 'qwen3.8-27b-nvfp4', 1000000);
    expect(toml).toContain('[context_windows]');
    expect(toml).toContain('"qwen3.8-27b-nvfp4" = 1000000');
    // listGroups 回填:组默认模型命中。
    const groups = listGroups(toml);
    expect(groups[0].model).toBe('');
    // 更新值。
    toml = setGroupContextWindow(toml, 'qwen3.8-27b-nvfp4', 500000);
    expect(readContextWindows(toml)['qwen3.8-27b-nvfp4']).toBe(500000);
    // 删除键 → 空表连同表头摘除。
    toml = setGroupContextWindow(toml, 'qwen3.8-27b-nvfp4', null);
    expect(toml).not.toContain('[context_windows]');
  });

  it('listGroups 按组默认模型回填 contextWindow', () => {
    const toml = [
      '[[model_group]]',
      'id = "openai"',
      'model = "qwen3.8-27b-nvfp4"',
      '',
      '[context_windows]',
      '"qwen3.8-27b-nvfp4" = 1000000',
    ].join('\n');
    const groups = listGroups(toml);
    expect(groups[0].contextWindow).toBe(1000000);
  });

  // 后端 ContextWindowsSection 的 Serialize 是 derive 的:任何一次
  // zhuye_save_config 落盘都会把扁平表重序列化为嵌套 [context_windows.entries]
  // (实测存量 config.toml 即此形态)。前端必须双形态兼容,否则保存后
  // 永远读回空、再次写入又追加第二张表 → 值被引擎静默丢弃(实测 bug)。
  it('readContextWindows 兼容嵌套 [context_windows.entries] 形态', () => {
    const toml = [
      '[model]',
      'reasoning_effort = "high"',
      '',
      '[context_windows.entries]',
      '"qwen3.8-27b-nvfp4" = 1000000',
      '"qwen-flash" = 500000',
    ].join('\n');
    const w = readContextWindows(toml);
    expect(w['qwen3.8-27b-nvfp4']).toBe(1000000);
    expect(w['qwen-flash']).toBe(500000);
    expect(w['reasoning_effort']).toBeUndefined();
  });

  it('嵌套形态下写入/更新/删除都落在 entries 子表内', () => {
    const nested = [
      '[context_windows.entries]',
      '"qwen3.8-27b-nvfp4" = 1000000',
      '',
      '[[model_group]]',
      'id = "demo"',
    ].join('\n');
    // 新键插入 entries 子表内(不得另写扁平表 —— 那会被引擎 Nested 分支丢弃)。
    const withNew = setGroupContextWindow(nested, 'qwen-flash', 500000);
    expect(withNew.indexOf('"qwen-flash" = 500000')).toBeLessThan(withNew.indexOf('[[model_group]]'));
    expect(withNew.indexOf('"qwen-flash" = 500000')).toBeGreaterThan(withNew.indexOf('[context_windows.entries]'));
    expect(withNew).not.toMatch(/\[context_windows\]\n/);
    // 更新已有键。
    const updated = setGroupContextWindow(withNew, 'qwen3.8-27b-nvfp4', 256000);
    expect(readContextWindows(updated)['qwen3.8-27b-nvfp4']).toBe(256000);
    // 删除全部键 → entries 子表连同表头摘除。
    const removed = setGroupContextWindow(updated, 'qwen3.8-27b-nvfp4', null);
    expect(readContextWindows(removed)['qwen3.8-27b-nvfp4']).toBeUndefined();
    expect(removed).toContain('[context_windows.entries]');
    const emptied = setGroupContextWindow(removed, 'qwen-flash', null);
    expect(emptied).not.toContain('[context_windows.entries]');
    expect(emptied).toContain('[[model_group]]');
  });

  it('混合文档(扁平 + 嵌套并存)读嵌套值,写入落嵌套表', () => {
    // 历史混合形态:前端曾在嵌套表已存在时追加扁平表 —— 引擎 Either
    // 先试 Flat 失败后落 Nested,扁平 kv 被静默丢弃,嵌套值才是实读值。
    const mixed = [
      '[context_windows.entries]',
      '"qwen-flash" = 500000',
      '',
      '[context_windows]',
      '"glm-5" = 128000',
    ].join('\n');
    expect(readContextWindows(mixed)['qwen-flash']).toBe(500000);
    expect(readContextWindows(mixed)['glm-5']).toBe(128000);
    const updated = setGroupContextWindow(mixed, 'qwen-flash', 600000);
    expect(readContextWindows(updated)['qwen-flash']).toBe(600000);
    // 写入必须命中嵌套表区间(扁平表在后面,不应插到其后产生新表)。
    expect(updated.indexOf('"qwen-flash" = 600000')).toBeLessThan(updated.indexOf('[context_windows]'));
  });
});

describe('[model].reasoning_effort 读写', () => {
  it('readDefaultEffort 读已有值,无段返回空', () => {
    expect(readDefaultEffort('[model]\nreasoning_effort = "high"\n')).toBe('high');
    expect(readDefaultEffort('[[model_group]]\nid = "x"\n')).toBe('');
  });

  it('setDefaultEffort 新建 [model] 段 / 更新 / 删除键', () => {
    let toml = '[[model_group]]\nid = "openai"\n';
    toml = setDefaultEffort(toml, 'medium');
    expect(toml).toContain('[model]');
    expect(toml).toContain('reasoning_effort = "medium"');
    expect(readDefaultEffort(toml)).toBe('medium');
    toml = setDefaultEffort(toml, '');
    expect(readDefaultEffort(toml)).toBe('');
    expect(toml).toContain('[[model_group]]');
  });
});
