/**
 * Vitest — slash engine 解析 + 分发测试。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setPluginSlashCommands, SLASH_COMMANDS } from './slashCommands';
import {
  parseSlash,
  executeSlash,
  dispatch,
  resolveCommand,
  type ParsedSlash,
} from './slashEngine';

const CTX = { activeSessionId: 's-active', now: () => new Date('2026-01-01T00:00:00Z') };

afterEach(() => {
  // 插件命令注册表是模块级状态,用例后复位,避免串扰。
  setPluginSlashCommands([]);
});

describe('parseSlash', () => {
  it('returns isSlash=false for plain text', () => {
    const p = parseSlash('hello world');
    expect(p.isSlash).toBe(false);
    if (!p.isSlash) expect(p.raw).toBe('hello world');
  });

  it('parses /command', () => {
    const p = parseSlash('/compact');
    expect(p.isSlash).toBe(true);
    if (p.isSlash) {
      expect(p.command).toBe('compact');
      expect(p.args).toEqual([]);
    }
  });

  it('parses /command args', () => {
    const p = parseSlash('/effort high');
    expect(p.isSlash).toBe(true);
    if (p.isSlash) {
      expect(p.command).toBe('effort');
      expect(p.args).toEqual(['high']);
    }
  });

  it('parses /command with multi-word args', () => {
    const p = parseSlash('/rename My Cool Session');
    expect(p.isSlash).toBe(true);
    if (p.isSlash) {
      expect(p.command).toBe('rename');
      expect(p.args).toEqual(['My', 'Cool', 'Session']);
    }
  });

  it('lowercases command', () => {
    const p = parseSlash('/COMPACT');
    expect(p.isSlash).toBe(true);
    if (p.isSlash) expect(p.command).toBe('compact');
  });
});

describe('resolveCommand', () => {
  it('finds by primary name', () => {
    expect(resolveCommand('compact')?.name).toBe('compact');
  });
  it('finds by alias', () => {
    expect(resolveCommand('?')?.name).toBe('help');
    expect(resolveCommand('exitplan')?.name).toBe('exit-plan');
  });
  it('returns null on unknown', () => {
    expect(resolveCommand('nope')).toBeNull();
  });
});

describe('executeSlash — Tier A real dispatch', () => {
  it('/compact → submit_with_submission:compact', () => {
    const p = parseSlash('/compact');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('compact');
  });

  it('/plan → enter_plan_mode', () => {
    const p = parseSlash('/plan refactor');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('enter_plan_mode');
    expect(r.message).toContain('refactor');
  });

  it('/exit-plan → exit_plan_mode', () => {
    const p = parseSlash('/exit-plan');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.submission).toBe('exit_plan_mode');
  });

  it('/goal <desc> → start_goal（GUI 语义:开目标会话）', () => {
    const p = parseSlash('/goal make all tests pass');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('start_goal');
    expect(r.message).toContain('make all tests pass');
  });

  it('/goal clear → exit_goal_mode', () => {
    const p = parseSlash('/goal clear');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.submission).toBe('exit_goal_mode');
  });

  it('/goal (no arg) → reject', () => {
    const p = parseSlash('/goal');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('reject');
  });

  it('/effort low|medium|high|max|ultra ok', () => {
    // 上游 v1.x 起 max / ultra 为新增档位。
    for (const level of ['low', 'medium', 'high', 'max', 'ultra']) {
      const p = parseSlash(`/effort ${level}`);
      if (!p.isSlash) throw new Error('not slash');
      const r = executeSlash(p as ParsedSlash, CTX);
      expect(r.submission).toBe('set_effort');
      expect(r.message).toContain(level);
    }
  });

  it('/prompt → prompt_list submission', () => {
    // v1.6.1:提示词层查询 —— 展开面板并拉取可用层/生效层。
    const p = parseSlash('/prompt');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('prompt_list');
  });

  it('/usage → open_usage submission', () => {
    // 模型级用量视图 —— 路由到 /usage。
    const p = parseSlash('/usage');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('open_usage');
  });

  it('/effort (no arg) → reject', () => {
    const p = parseSlash('/effort');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('reject');
  });

  it('/effort bogus → reject', () => {
    const p = parseSlash('/effort bogus');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('reject');
  });

  it('/mode auto → set_permission_mode', () => {
    const p = parseSlash('/mode auto');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.submission).toBe('set_permission_mode');
  });

  it('/mode (no arg) → reject', () => {
    const p = parseSlash('/mode');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('reject');
  });

  it('/mode all variants accepted', () => {
    for (const mode of ['auto', 'prompt', 'deny', 'plan', 'accept_edits', 'bubble', 'bypass']) {
      const p = parseSlash(`/mode ${mode}`);
      if (!p.isSlash) throw new Error('not slash');
      const r = executeSlash(p as ParsedSlash, CTX);
      expect(r.submission).toBe('set_permission_mode');
      expect(r.message).toContain(mode);
    }
  });

  it('/help → no-op with count', () => {
    const p = parseSlash('/help');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.kind).toBe('no-op');
    expect(r.message).toContain(String(SLASH_COMMANDS.length));
  });
});

describe('executeSlash — session-bound commands', () => {
  it('/rename without active session → reject', () => {
    const p = parseSlash('/rename Foo');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, { ...CTX, activeSessionId: null });
    expect(r.kind).toBe('reject');
  });

  it('/rename with active session → submit_with_submission', () => {
    const p = parseSlash('/rename Foo');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.submission).toBe('rename_session');
  });

  it('/export with active session → submit_with_submission', () => {
    const p = parseSlash('/export');
    if (!p.isSlash) throw new Error('not slash');
    const r = executeSlash(p as ParsedSlash, CTX);
    expect(r.submission).toBe('export_session');
  });
});

describe('dispatch', () => {
  it('non-slash returns plain text payload', () => {
    const r = dispatch('hi there', CTX);
    if ('isSlash' in r) {
      expect(r.isSlash).toBe(false);
    } else {
      throw new Error('expected SlashInput');
    }
  });

  it('slash routes through executeSlash', () => {
    const r = dispatch('/interrupt', CTX);
    if (!('kind' in r)) throw new Error('expected SlashResult');
    expect(r.kind).toBe('submit_with_submission');
    expect(r.submission).toBe('interrupt');
  });

  it('unknown slash → reject', () => {
    const r = dispatch('/nonexistent', CTX);
    if (!('kind' in r)) throw new Error('expected SlashResult');
    expect(r.kind).toBe('reject');
  });

  it('plugin command → PlainText 直通(原样提交,后端展开)', () => {
    setPluginSlashCommands([{ name: 'demo:hello', description: 'say hi' }]);
    try {
      const r = dispatch('/demo:hello world', CTX);
      if (!('isSlash' in r) || r.isSlash) throw new Error('expected PlainText');
      // raw 原样保留 —— useComposerSubmission 的 PlainText 分支把它
      // 作为普通文本 submit,后端 expand_submission 做真正展开。
      expect(r.raw).toBe('/demo:hello world');
    } finally {
      setPluginSlashCommands([]);
    }
  });

  it('未挂载同名命令时仍 reject(与未知命令同路径)', () => {
    // 注册表为空:`/demo:hello` 不被识别为插件命令。
    const r = dispatch('/demo:hello world', CTX);
    if (!('kind' in r)) throw new Error('expected SlashResult');
    expect(r.kind).toBe('reject');
  });

  it('内置命令优先:同名注册不能劫持内置语义', () => {
    setPluginSlashCommands([{ name: 'compact', description: null }]);
    try {
      // resolveCommand 先命中内置 compact → 走 executeSlash,
      // 插件注册表不参与(脏注册不会改变内置行为)。
      const r = dispatch('/compact', CTX);
      if (!('kind' in r)) throw new Error('expected SlashResult');
      expect(r.kind).toBe('submit_with_submission');
      expect(r.submission).toBe('compact');
    } finally {
      setPluginSlashCommands([]);
    }
  });
});
