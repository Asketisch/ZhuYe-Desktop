/**
 * Vitest — groups.ts 纯 TOML 手术的单测。
 *
 * 覆盖:解析([[provider_group]] 条目 + 嵌套 credentials 隔离)、upsert
 * (新增/更新/改名保嵌套)、remove(整组归属含 credentials)、id 校验
 * (保留名/'/'/歧义字符)、默认组切换。
 */
import { describe, expect, it } from 'vitest';
import {
  groupDisplayLabel,
  isValidGroupId,
  listGroups,
  readActiveGroup,
  removeGroup,
  setActiveGroup,
  upsertGroup,
} from './groups';

const SAMPLE_TOML = `[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top"

[[provider_group]]
id = "bigmodel"
label = "智谱 GLM"
endpoint = "openai"
base_url = "https://open.bigmodel.cn/api/paas/v4"
api_key = "sk-glm"
model = "GLM-5.3-Flash"

[[provider_group]]
id = "demo"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"

[[provider_group.credentials]]
label = "backup"
api_key = "sk-backup"

[context_windows]
"GLM-5.3-Flash" = 200000
`;

describe('groups.ts 纯函数', () => {
  it('解析全部组条目(嵌套 credentials 不混入组字段)', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 'bigmodel',
      label: '智谱 GLM',
      endpoint: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-glm',
      model: 'GLM-5.3-Flash',
      responsesApi: false,
    });
    // 第二个组没有 api_key/model 字段 → 空串(免 Key 组)。
    expect(groups[1].id).toBe('demo');
    expect(groups[1].apiKey).toBe('');
    expect(groups[1].model).toBe('');
  });

  it('responses_api = true 解析为布尔', () => {
    const groups = listGroups(
      '[[provider_group]]\nid = "x"\nendpoint = "openai"\nresponses_api = true\n',
    );
    expect(groups[0].responsesApi).toBe(true);
  });

  it('isValidGroupId 拒绝空 / "/" / 歧义字符 / 内置保留名', () => {
    expect(isValidGroupId('bigmodel')).toBe(true);
    expect(isValidGroupId('my-glm_2')).toBe(true);
    expect(isValidGroupId('')).toBe(false);
    expect(isValidGroupId('  ')).toBe(false);
    expect(isValidGroupId('a/b')).toBe(false);
    expect(isValidGroupId('a[b]')).toBe(false);
    expect(isValidGroupId('anthropic')).toBe(false);
    expect(isValidGroupId('openai')).toBe(false);
    expect(isValidGroupId('ollama')).toBe(false);
    expect(isValidGroupId('mock')).toBe(false);
  });

  it('groupDisplayLabel:显式 label 优先,缺省回退 id', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(groupDisplayLabel(groups[0])).toBe('智谱 GLM');
    expect(groupDisplayLabel(groups[1])).toBe('demo');
  });

  it('readActiveGroup:active.provider 命中组 id 返回该组,内置名返回 null', () => {
    const groups = listGroups(SAMPLE_TOML);
    expect(readActiveGroup(SAMPLE_TOML, groups)).toBeNull();
    const switched = setActiveGroup(SAMPLE_TOML, 'demo');
    expect(readActiveGroup(switched, groups)?.id).toBe('demo');
    // 内置端口名不属于任何组。
    expect(readActiveGroup(setActiveGroup(SAMPLE_TOML, 'openai'), groups)).toBeNull();
  });

  it('upsertGroup 新组追加到已有组的归属块之后(组条目保持相邻)', () => {
    const next = upsertGroup(SAMPLE_TOML, {
      id: 'new-gw',
      label: '',
      endpoint: 'openai',
      apiKey: '',
      baseUrl: 'https://gw.example.com',
      model: '',
      responsesApi: false,
      timeoutSecs: '',
    });
    expect(next).toContain('[[provider_group]]\nid = "new-gw"');
    // 后续段([context_windows])仍在,且新组条目先于它。
    expect(next).toContain('[context_windows]');
    expect(next.indexOf('id = "new-gw"')).toBeLessThan(next.indexOf('[context_windows]'));
  });

  it('upsertGroup 更新既有组:仅替换该组 kv 行,嵌套 credentials 保留', () => {
    const next = upsertGroup(SAMPLE_TOML, {
      id: 'demo',
      label: '示例网关',
      endpoint: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9999',
      model: 'demo/model-a',
      responsesApi: false,
      timeoutSecs: '60',
    });
    expect(next).toContain('base_url = "http://127.0.0.1:9999"');
    expect(next).toContain('model = "demo/model-a"');
    expect(next).toContain('timeout_secs = 60');
    // 嵌套 credentials(手写的高级形态)必须原样保留。
    expect(next).toContain('[[provider_group.credentials]]');
    expect(next).toContain('label = "backup"');
    // 解析回读一致。
    const groups = listGroups(next);
    expect(groups[1]).toMatchObject({ id: 'demo', baseUrl: 'http://127.0.0.1:9999', model: 'demo/model-a' });
  });

  it('改名 = removeGroup(旧 id) + upsertGroup(新 id),不残留旧条目', () => {
    // GUI 编辑路径(与 GroupForm.onSaveGroup 一致):先摘旧块再写新块。
    const removed = removeGroup(SAMPLE_TOML, 'demo');
    const next = upsertGroup(removed, {
      id: 'demo-v2',
      label: '',
      endpoint: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:3425',
      model: '',
      responsesApi: false,
      timeoutSecs: '',
    });
    expect(next).not.toContain('id = "demo"');
    expect(listGroups(next).map((g) => g.id)).toEqual(['bigmodel', 'demo-v2']);
  });

  it('removeGroup 清除整组归属(含嵌套 credentials)', () => {
    const next = removeGroup(SAMPLE_TOML, 'demo');
    expect(listGroups(next)).toHaveLength(1);
    expect(next).not.toContain('[[provider_group.credentials]]');
    expect(next).not.toContain('label = "backup"');
    // 其他段不受影响。
    expect(next).toContain('id = "bigmodel"');
    expect(next).toContain('[context_windows]');
  });

  it('removeGroup 未知 id 原样返回', () => {
    expect(removeGroup(SAMPLE_TOML, 'ghost')).toBe(SAMPLE_TOML);
  });

  it('免 Key 组(无 api_key 行)解析与 upsert 往返一致', () => {
    const next = upsertGroup('', {
      id: 'free-pool',
      label: '',
      endpoint: 'openai',
      apiKey: '',
      baseUrl: 'https://free.example.test',
      model: 'm1',
      responsesApi: false,
      timeoutSecs: '',
    });
    // api_key 为空 → 整行不写(引擎侧 Option 缺省,None 与 "" 同语义)。
    expect(next).not.toContain('api_key');
    const groups = listGroups(next);
    expect(groups[0]).toMatchObject({ id: 'free-pool', apiKey: '', model: 'm1' });
  });

  it('upsertGroup 对非法 id 原样返回(调用方先做 UI 校验)', () => {
    expect(upsertGroup(SAMPLE_TOML, {
      id: 'a/b',
      label: '',
      endpoint: 'openai',
      apiKey: '',
      baseUrl: '',
      model: '',
      responsesApi: false,
      timeoutSecs: '',
    })).toBe(SAMPLE_TOML);
  });
});
