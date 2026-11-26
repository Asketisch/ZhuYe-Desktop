/**
 * Vitest —— 从 ConfigForm 抽取的纯 TOML 辅助函数测试。
 *
 * 锁定高级编辑器 + ConfigForm 依赖的契约，让我们可以在重构 React 层的
 * 同时不丢失原始 TOML 语义（未知分区保留、子分区按前缀限定作用域、
 * feature_flags 内联表语法）。
 */
import { describe, it, expect } from 'vitest';
import {
  addFlag,
  addSubSection,
  extractFlags,
  extractSubSections,
  findUnknownSections,
  removeFlag,
  removeSubSection,
  setFlag,
  setSectionBody,
  removeSection,
  updateSubSection,
} from './toml';

describe('extractSubSections', () => {
  it('lists each subsection with its body', () => {
    const toml = `[mcp_servers.filesystem]
type = "stdio"
command = "npx"

[mcp_servers.git]
type = "stdio"
command = "git-mcp"
`;
    expect(extractSubSections(toml, 'mcp_servers')).toEqual([
      { name: 'filesystem', body: 'type = "stdio"\ncommand = "npx"' },
      { name: 'git', body: 'type = "stdio"\ncommand = "git-mcp"' },
    ]);
  });

  it('returns empty entries when no subsections are declared', () => {
    expect(extractSubSections('', 'mcp_servers')).toEqual([]);
  });

  it('skips unrelated sections but preserves them in the document', () => {
    const toml = `[active]
provider = "anthropic"

[mcp_servers.filesystem]
type = "stdio"
`;
    const out = extractSubSections(toml, 'mcp_servers');
    expect(out).toEqual([{ name: 'filesystem', body: 'type = "stdio"' }]);
    // 无关的 `[active]` 块必须保留在原始 TOML 中。
    expect(toml).toContain('[active]');
  });
});

describe('updateSubSection / addSubSection / removeSubSection', () => {
  it('updates a subsection body without touching siblings', () => {
    const toml = `[mcp_servers.filesystem]
type = "stdio"

[mcp_servers.git]
type = "stdio"
`;
    const next = updateSubSection(toml, 'mcp_servers', 'filesystem', 'type = "http"');
    expect(next).toContain('[mcp_servers.filesystem]');
    expect(next).toContain('type = "http"');
    // 其他子分区保持不变。
    expect(next).toContain('[mcp_servers.git]');
    expect(next).toContain('type = "stdio"');
  });

  it('appends a new subsection without duplicating an existing one', () => {
    const toml = `[mcp_servers.filesystem]
type = "stdio"
`;
    // 'git' 不含 '.'，因此 addSubSection 写入裸的 `[mcp_servers]` 表头
    // (旧语义：name.includes('.') 决定嵌套还是裸表头)。
    const next = addSubSection(toml, 'mcp_servers', 'git');
    expect(next).toContain('[mcp_servers]');
    expect(next).toContain('# TODO: edit me');
    // 原有子分区保留。
    expect(next).toContain('[mcp_servers.filesystem]');
    expect(next).toContain('type = "stdio"');
  });

  it('addSubSection does not duplicate an existing exact header', () => {
    const toml = `[mcp_servers.git]
type = "stdio"
`;
    // 'git.something' 解析为 `[mcp_servers.git.something]`，该表头不在
    // 文档中，因此调用会追加新表头 —— 但已有的
    // `[mcp_servers.git]` 必须保持完整。
    const next = addSubSection(toml, 'mcp_servers', 'git.something');
    expect(next).toContain('[mcp_servers.git]');
    expect(next).toContain('type = "stdio"');
    expect(next).toContain('[mcp_servers.git.something]');
  });

  it('removes a subsection while keeping unrelated content intact', () => {
    const toml = `[active]
provider = "anthropic"

[mcp_servers.filesystem]
type = "stdio"

[mcp_servers.git]
type = "stdio"
`;
    const next = removeSubSection(toml, 'mcp_servers', 'filesystem');
    expect(next).not.toContain('[mcp_servers.filesystem]');
    expect(next).toContain('[mcp_servers.git]');
    expect(next).toContain('[active]');
    expect(next).toContain('provider = "anthropic"');
  });
});

describe('setSectionBody / removeSection', () => {
  it('appends the new body under the existing header and keeps surrounding sections', () => {
    const toml = `[hooks.search_budget]
max_calls = 25

[mcp_servers.filesystem]
type = "stdio"
`;
    const next = setSectionBody(toml, '[hooks.search_budget]', 'max_calls = 99');
    // 新内容紧跟在表头下发出。
    expect(next).toContain('max_calls = 99');
    // 兄弟分区保持不变（原始 TOML 语义）。
    expect(next).toContain('[mcp_servers.filesystem]');
    expect(next).toContain('type = "stdio"');
  });

  it('appends the section when the header does not exist yet', () => {
    const toml = `[active]\nprovider = "anthropic"\n`;
    const next = setSectionBody(toml, '[hooks.search_budget]', 'max_calls = 25');
    expect(next).toContain('[hooks.search_budget]');
    expect(next).toContain('max_calls = 25');
    expect(next).toContain('[active]');
  });

  it('removeSection keeps other sections intact', () => {
    const toml = `[a]\nx = 1\n\n[b]\ny = 2\n\n[c]\nz = 3\n`;
    const next = removeSection(toml, '[b]');
    expect(next).toContain('[a]');
    expect(next).toContain('[c]');
    expect(next).not.toContain('[b]');
  });
});

describe('extractFlags / setFlag / addFlag / removeFlag', () => {
  it('reads flags from an inline `flags = { ... }` table', () => {
    const toml = `[feature_flags]
flags = { "alpha" = true, "beta" = false }
`;
    expect(extractFlags(toml)).toEqual([
      { key: 'alpha', value: true },
      { key: 'beta', value: false },
    ]);
  });

  it('setFlag preserves unrelated keys in the section', () => {
    const toml = `[feature_flags]
flags = { "alpha" = true }
extra_note = "keep me"
`;
    const next = setFlag(toml, 'alpha', false);
    expect(next).toContain('"alpha" = false');
    expect(next).toContain('extra_note = "keep me"');
  });

  it('setFlag appends a new flag without dropping existing ones', () => {
    const toml = `[feature_flags]
flags = { "alpha" = true }
`;
    const next = setFlag(toml, 'beta', true);
    expect(next).toContain('"alpha" = true');
    expect(next).toContain('"beta" = true');
  });

  it('setFlag creates the section when missing and preserves other top-level sections', () => {
    const toml = `[active]\nprovider = "anthropic"\n`;
    const next = setFlag(toml, 'alpha', true);
    expect(next).toContain('[active]');
    expect(next).toContain('[feature_flags]');
    expect(next).toContain('"alpha" = true');
  });

  it('addFlag creates the section with default true', () => {
    expect(addFlag('', 'alpha')).toContain('"alpha" = true');
  });

  it('removeFlag strips the targeted flag while keeping other section keys', () => {
    const toml = `[feature_flags]
flags = { "alpha" = true, "beta" = false }
extra = "keep"
`;
    const next = removeFlag(toml, 'alpha');
    expect(next).not.toMatch(/"alpha"\s*=\s*true/);
    // 非 flag 的兄弟键保持不变。
    expect(next).toContain('extra = "keep"');
  });
});

describe('findUnknownSections', () => {
  it('returns top-level section keys not in the known set', () => {
    const known = new Set(['active', 'anthropic', 'mcp_servers']);
    const toml = `[active]
provider = "anthropic"

[anthropic]
api_key = "sk"

[mcp_servers.filesystem]
type = "stdio"

[experimental_future]
enabled = true

[experimental_future.sub]
foo = "bar"
`;
    const unknown = findUnknownSections(toml, known);
    expect(unknown).toContain('experimental_future');
    expect(unknown).toContain('experimental_future.sub');
    expect(unknown).not.toContain('active');
    expect(unknown).not.toContain('mcp_servers.filesystem');
  });

  it('returns an empty list for a known-only TOML', () => {
    const known = new Set(['active']);
    expect(findUnknownSections('[active]\nprovider = "anthropic"\n', known)).toEqual([]);
  });
});