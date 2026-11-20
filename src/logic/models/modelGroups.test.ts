/**
 * Vitest —— 模型组访问层（`[[model_group]]` + `[active].group`）。
 *
 * 覆盖新契约的核心：
 *  1. 解析 `[[model_group]]` 与组内 `[[model_group.credentials]]`；
 *  2. `[active].group` / `[active].credential` 的读写；
 *  3. 「有可用凭据」的判定；
 *  4. 跨组 failover 目标挑选（跳过当前组 + 无凭据的组）。
 */
import { describe, expect, it } from 'vitest';
import {
  groupDisplayLabel,
  groupHasUsableCredential,
  listGroups,
  pickFailoverGroup,
  readActiveCredential,
  readActiveGroup,
  setActiveGroup,
} from './modelGroups';

const SAMPLE = `[active]
group = "demo"
credential = "备用"

[[model_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "sk-demo"
model = "demo/model-a"
timeout_secs = 120
num_ctx = 8192

[[model_group.credentials]]
label = "备用"
api_key = "sk-alt"
model = "demo/model-b"
quota = { window_secs = 3600, max_tokens = 1000 }

[[model_group]]
id = "solo"
endpoint = "openai"
base_url = "http://127.0.0.1:11434"
api_key = "sk-solo"
`;

describe('listGroups', () => {
  it('解析组与组内凭据', () => {
    const groups = listGroups(SAMPLE);
    expect(groups).toHaveLength(2);
    const demo = groups[0];
    expect(demo.id).toBe('demo');
    expect(demo.label).toBe('示例网关');
    expect(demo.endpoint).toBe('anthropic');
    expect(demo.baseUrl).toBe('http://127.0.0.1:3425');
    expect(demo.apiKey).toBe('sk-demo');
    expect(demo.model).toBe('demo/model-a');
    expect(demo.timeoutSecs).toBe(120);
    expect(demo.numCtx).toBe(8192);
    expect(demo.credentials).toHaveLength(1);
    expect(demo.credentials[0].label).toBe('备用');
    expect(demo.credentials[0].model).toBe('demo/model-b');
    expect(demo.credentials[0].quota).toEqual({ windowSecs: 3600, maxTokens: 1000 });
  });

  it('组 id 为空的条目被丢弃', () => {
    expect(listGroups('[[model_group]]\nlabel = "无 id"\n')).toEqual([]);
    expect(listGroups('')).toEqual([]);
  });

  it('兼容读入迁移前的 provider_group 段', () => {
    const legacy = '[[provider_group]]\nid = "demo"\napi_key = "sk-a"\n';
    expect(listGroups(legacy).map((g) => g.id)).toEqual(['demo']);
  });
});

describe('readActiveGroup / readActiveCredential / setActiveGroup', () => {
  it('读 [active].group 与 [active].credential', () => {
    expect(readActiveGroup(SAMPLE)).toBe('demo');
    expect(readActiveCredential(SAMPLE)).toBe('备用');
  });

  it('未配置时为空串', () => {
    expect(readActiveGroup('')).toBe('');
    expect(readActiveCredential('[active]\ngroup = "demo"\n')).toBe('');
  });

  it('setActiveGroup 写 [active].group', () => {
    const next = setActiveGroup(SAMPLE, 'solo');
    expect(readActiveGroup(next)).toBe('solo');
  });

  it('setActiveGroup 清掉迁移前的 [active].provider 旧键', () => {
    const legacy = '[active]\nprovider = "demo"\n';
    const next = setActiveGroup(legacy, 'solo');
    expect(next).toContain('group = "solo"');
    expect(next).not.toContain('provider =');
  });
});

describe('groupDisplayLabel', () => {
  it('label 优先，缺省回退 id', () => {
    const groups = listGroups(SAMPLE);
    expect(groupDisplayLabel(groups[0])).toBe('示例网关');
    expect(groupDisplayLabel(groups[1])).toBe('solo');
  });
});

describe('groupHasUsableCredential', () => {
  it('组自身带 api_key 即算可用', () => {
    const groups = listGroups(SAMPLE);
    expect(groupHasUsableCredential(groups[0])).toBe(true);
    expect(groupHasUsableCredential(groups[1])).toBe(true);
  });

  it('组内任一凭据可用也算可用', () => {
    const groups = listGroups('[[model_group]]\nid = "g"\n\n[[model_group.credentials]]\nlabel = "c"\napi_key = "sk"\n');
    expect(groupHasUsableCredential(groups[0])).toBe(true);
  });

  it('既无 key 也无凭据 = 无可用凭据', () => {
    const groups = listGroups('[[model_group]]\nid = "g"\nlabel = "空组"\n');
    expect(groupHasUsableCredential(groups[0])).toBe(false);
  });
});

describe('pickFailoverGroup', () => {
  const THREE = `[active]
group = "a"

[[model_group]]
id = "a"
api_key = "sk-a"

[[model_group]]
id = "b"
api_key = "sk-b"

[[model_group]]
id = "c"
`;

  it('跳过当前组，挑下一个有可用凭据的组', () => {
    expect(pickFailoverGroup(THREE, 'a')?.id).toBe('b');
    expect(pickFailoverGroup(THREE, 'b')?.id).toBe('a');
  });

  it('无可用凭据的组不被选中', () => {
    expect(pickFailoverGroup(THREE, 'a')?.id).not.toBe('c');
    expect(pickFailoverGroup('[active]\ngroup = "c"\n', 'c')).toBeNull();
  });
});
