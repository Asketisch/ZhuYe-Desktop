/**
 * Vitest — SLASH_COMMANDS 数据完整性测试 + 插件命令注册表。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  SLASH_COMMANDS,
  TIER_A_TOOLBAR,
  filterSlashCommands,
  setPluginSlashCommands,
  getPluginSlashCommands,
  isPluginCommand,
} from '@/logic/input/composer/slashCommands';

afterEach(() => {
  // 注册表是模块级状态,每个用例后复位,避免串扰。
  setPluginSlashCommands([]);
});

describe('SLASH_COMMANDS', () => {
  it('has unique command names', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('each command has category', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.category).toBeTruthy();
    }
  });

  it('each command has summaryKey', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.summaryKey.length).toBeGreaterThan(0);
    }
  });

  it('includes 7 toolbar commands (Tier A)', () => {
    expect(TIER_A_TOOLBAR.length).toBe(7);
    const toolbarNames = TIER_A_TOOLBAR.map((c) => c.name);
    // 纯 TUI 镜像 stub（theme/vim）已下架。
    expect(toolbarNames).not.toContain('theme');
    expect(toolbarNames).not.toContain('vim');
    expect(toolbarNames).toContain('effort');
    expect(toolbarNames).toContain('compact');
    expect(toolbarNames).toContain('mode');
    expect(toolbarNames).toContain('model');
  });

  it('does not list TUI-only stub commands', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).not.toContain('theme');
    expect(names).not.toContain('vim');
  });

  it('includes aliases where defined', () => {
    const help = SLASH_COMMANDS.find((c) => c.name === 'help');
    expect(help?.aliases).toContain('?');
    const mode = SLASH_COMMANDS.find((c) => c.name === 'mode');
    expect(mode?.aliases).toBeUndefined();
  });

  it('aliases are also unique', () => {
    const allAliases: string[] = [];
    for (const c of SLASH_COMMANDS) {
      if (c.aliases) allAliases.push(...c.aliases);
    }
    expect(new Set(allAliases).size).toBe(allAliases.length);
  });
});

describe('plugin slash commands registry', () => {
  const demo = { name: 'demo:hello', description: 'say hi' };

  it('set/get 覆写注册表,空数组即清空', () => {
    expect(getPluginSlashCommands()).toEqual([]);
    setPluginSlashCommands([demo]);
    expect(getPluginSlashCommands()).toEqual([demo]);
    setPluginSlashCommands([]);
    expect(getPluginSlashCommands()).toEqual([]);
  });

  it('isPluginCommand 精确匹配命令名(大小写不敏感)', () => {
    setPluginSlashCommands([demo]);
    expect(isPluginCommand('demo:hello')).toBe(true);
    expect(isPluginCommand('DEMO:HELLO')).toBe(true);
    expect(isPluginCommand('demo')).toBe(false);
    expect(isPluginCommand('compact')).toBe(false);
  });

  it('注册表为空时 isPluginCommand 恒 false,弹层不出现插件候选', () => {
    expect(isPluginCommand('demo:hello')).toBe(false);
    const names = filterSlashCommands('').map((c) => c.name);
    expect(names).not.toContain('demo:hello');
  });

  it('弹层候选追加插件命令(无 query 时全量附在内置之后)', () => {
    setPluginSlashCommands([demo]);
    const all = filterSlashCommands('');
    expect(all.some((c) => c.name === 'demo:hello')).toBe(true);
    // 插件命令附在内置命令之后。
    expect(all[all.length - 1].name).toBe('demo:hello');
    // 携带真实 description,弹层直接渲染不走 i18n。
    expect(all.find((c) => c.name === 'demo:hello')?.description).toBe('say hi');
  });

  it('按前缀过滤:输入 `demo` 只命中插件命令,内置不误伤', () => {
    setPluginSlashCommands([demo, { name: 'reviewer:lint', description: null }]);
    const names = filterSlashCommands('demo').map((c) => c.name);
    expect(names).toEqual(['demo:hello']);
    const reviewer = filterSlashCommands('revi').map((c) => c.name);
    expect(reviewer).toEqual(['reviewer:lint']);
  });

  it('不匹配 query 的插件命令不出现', () => {
    setPluginSlashCommands([demo]);
    expect(filterSlashCommands('mode').map((c) => c.name)).not.toContain('demo:hello');
  });
});