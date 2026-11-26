/**
 * allowRule —— 「始终允许这条命令」的规则推导测试。
 *
 * 验证授权口径:
 *   - Bash → 整条命令精确匹配(不是「首词 + 通配」)
 *   - 只读工具 → 整个工具放行
 *   - 写类工具 → 不给规则(不给「始终允许」按钮)
 *   - 参数缺失 / 非字符串 → 不给规则
 */
import { describe, it, expect } from 'vitest';
import { deriveAllowRule, extractCommand } from './allowRule';

describe('deriveAllowRule', () => {
  it('Bash → 整条命令精确匹配', () => {
    const rule = deriveAllowRule('Bash', { cmd: 'git status' });
    expect(rule).toEqual({
      tool: 'Bash',
      action: 'allow',
      toolGlob: null,
      shellPattern: 'git status',
    });
  });

  it('Bash → 不用「首词 + 通配」(那会顺带放行 rm / curl|sh)', () => {
    const rule = deriveAllowRule('bash', { cmd: 'rm -rf /tmp/x' });
    expect(rule?.shellPattern).toBe('rm -rf /tmp/x');
    expect(rule?.shellPattern).not.toContain('*');
  });

  it('命令首尾空白被裁掉', () => {
    expect(deriveAllowRule('Bash', { cmd: '  ls -la  ' })?.shellPattern).toBe('ls -la');
  });

  it('对 glob 元字符逐个转义，避免授权扩大', () => {
    expect(deriveAllowRule('bash', { cmd: 'echo * ? [x] {a,b}' })?.shellPattern)
      .toBe('echo [*] [?] [[]x[]] [{]a,b[}]');
  });

  it('核心无法精确匹配复合命令或跨平台反斜杠时不生成规则', () => {
    for (const cmd of ['echo a; echo b', 'echo a | cat', 'echo a && echo b', 'echo a\necho b', 'echo \\*']) {
      expect(deriveAllowRule('bash', { cmd })).toBeNull();
    }
  });

  it('只读工具 → 整个工具放行', () => {
    expect(deriveAllowRule('read', { path: '/tmp/a' })).toEqual({
      tool: 'read',
      action: 'allow',
      toolGlob: null,
      shellPattern: null,
    });
    expect(deriveAllowRule('grep', {})?.action).toBe('allow');
    expect(deriveAllowRule('glob', {})?.action).toBe('allow');
  });

  it('写类工具 → 不给规则(核心规则模型没有路径维度,放行整个写工具太宽)', () => {
    expect(deriveAllowRule('write', { path: '/tmp/a' })).toBeNull();
    expect(deriveAllowRule('edit', {})).toBeNull();
    expect(deriveAllowRule('delete', {})).toBeNull();
    expect(deriveAllowRule('web_fetch', {})).toBeNull();
  });

  it('参数缺失 / 命令为空 → 不给规则', () => {
    expect(deriveAllowRule('Bash', {})).toBeNull();
    expect(deriveAllowRule('Bash', { cmd: '   ' })).toBeNull();
    expect(deriveAllowRule('Bash', { cmd: 42 })).toBeNull();
    expect(deriveAllowRule('Bash', null)).toBeNull();
  });

  it('工具名缺失 → 不给规则', () => {
    expect(deriveAllowRule(undefined, { cmd: 'ls' })).toBeNull();
    expect(deriveAllowRule('   ', { cmd: 'ls' })).toBeNull();
  });
});

describe('extractCommand', () => {
  it('取 args.cmd 的非空字符串', () => {
    expect(extractCommand({ cmd: 'ls' })).toBe('ls');
    expect(extractCommand({ cmd: ' ls ' })).toBe('ls');
  });

  it('非对象 / 无 cmd / 空串 → null', () => {
    expect(extractCommand(null)).toBeNull();
    expect(extractCommand('ls')).toBeNull();
    expect(extractCommand({})).toBeNull();
    expect(extractCommand({ cmd: '' })).toBeNull();
    expect(extractCommand({ cmd: 1 })).toBeNull();
  });
});
