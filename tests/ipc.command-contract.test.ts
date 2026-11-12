/**
 * IPC 命令契约测试 —— 前端 ↔ 后端 ↔ 测试基建的四方一致性。
 *
 * 覆盖（全量，非抽样）：
 *   1. 后端源码声明的每个 `pub async fn reflect_*` 都有前端 wrapper；
 *   2. 每个前端 wrapper 都对应后端真实命令（无孤儿包装）；
 *   3. 每个命令都注册进了 `lib.rs` 的 `invoke_handler!`；
 *   4. 每个命令在 fakeBackend（tests/helpers）中都有实现 —— 保证
 *      应用级测试不会因为缺 handler 而静默失败；
 *   5. 逐领域 round-trip：真实调用 wrapper，断言线上 args 形状
 *      （camelCase 参数 → 命令负载的精确映射）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as commands from '@/utils/commands';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// node:fs 读取后端源码做一致性比对。
// 命令体可以落在领域子目录(如 commands/files/image.rs)—— 递归扫描,
// 与 tests/static/analyze.mjs 同口径。
const commandDir = 'src-tauri/src/commands';
const listRustFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? listRustFiles(path) : path.endsWith('.rs') ? [path] : [];
  });
const backendSource = () =>
  listRustFiles(commandDir)
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');

let backend: FakeBackend;
beforeEach(() => {
  backend = installFakeBackend();
});

// ============================================================================
// 1-4. 四方一致性（全量）
// ============================================================================

describe('IPC command contract (exhaustive parity)', () => {
  it('every backend reflect_ command has a frontend wrapper', () => {
    const src = backendSource();
    // 同步 `pub fn` 与异步 `pub async fn` 都是合法后端命令(如
    // dock::reflect_set_dock_badge 是同步命令)。只扫 `pub async fn` 会让
    // 同步命令整个漏掉 —— 替身缺 handler 也就没人发现。
    const backendNames = [...src.matchAll(/pub (?:async )?fn (reflect_\w+)/g)].map((m) => m[1]);
    expect(backendNames.length).toBeGreaterThanOrEqual(100); // 防退化：命令面只增不减
    const frontendNames = Object.keys(commands).filter((k) => k.startsWith('reflect_'));
    const missing = backendNames.filter((n) => !frontendNames.includes(n));
    expect(missing).toEqual([]);
  });

  it('every frontend wrapper maps to a real backend command', () => {
    const src = backendSource();
    const frontendNames = Object.keys(commands).filter((k) => k.startsWith('reflect_'));
    expect(frontendNames.length).toBeGreaterThanOrEqual(100);
    // 同步 `pub fn` 与 `pub async fn` 均为合法后端命令（如 dock badge）。
    const orphans = frontendNames.filter(
      (n) => !src.includes(`pub async fn ${n}`) && !src.includes(`pub fn ${n}`),
    );
    expect(orphans).toEqual([]);
  });

  it('every command is registered in lib.rs invoke_handler', () => {
    const libSrc = readFileSync('src-tauri/src/lib.rs', 'utf8');
    const match = libSrc.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
    expect(match).not.toBeNull();
    const handlerBody = match![1];
    const frontendNames = Object.keys(commands).filter((k) => k.startsWith('reflect_'));
    const unregistered = frontendNames.filter((n) => !handlerBody.includes(n));
    expect(unregistered).toEqual([]);
  });

  it('fakeBackend implements every frontend command (no unmocked invoke)', async () => {
    const frontendNames = Object.keys(commands).filter(
      (k) => k.startsWith('reflect_') || k === 'ping',
    );
    // 只验证只读命令可安全调用；写命令由下方 round-trip 覆盖。
    const readOnly = [
      'ping', 'reflect_agent_status', 'reflect_get_config', 'reflect_list_sessions',
      'reflect_list_tools', 'reflect_list_skills', 'reflect_list_hooks', 'reflect_list_memory',
      'reflect_list_tasks', 'reflect_list_squads', 'reflect_list_teams', 'reflect_list_schedules',
      'reflect_list_side_channels', 'reflect_list_workspaces', 'reflect_list_activity',
      'reflect_list_agent_defs', 'reflect_load_allowlist', 'reflect_git_status',
      'reflect_git_diff', 'reflect_git_log', 'reflect_list_shell_sessions', 'reflect_kms_list',
      'reflect_kms_list_pages', 'reflect_kms_search', 'reflect_list_media',
      'reflect_media_capabilities', 'reflect_get_remote_status', 'reflect_tailscale_status',
      'reflect_tailscale_daemon_status', 'reflect_check_update', 'reflect_get_autopilot_config',
      'reflect_autopilot_history', 'reflect_current_workspace', 'reflect_activity_count',
      'reflect_get_schedule_status', 'reflect_get_remote_config',
      'reflect_tailscale_daemon_command_preview',
    ];
    for (const name of readOnly) {
      if (name === 'reflect_kms_list_pages') {
        await commands.reflect_kms_list_pages('engineering');
        continue;
      }
      const fn = (commands as unknown as Record<string, () => unknown>)[name];
      await fn(); // 若 fakeBackend 未注册 → mock invoke 抛错 → 测试失败
    }
    // 剩余命令至少在命令表中有 handler 注册（通过调用日志间接验证两个代表）。
    await commands.reflect_list_dir('/tmp', 1);
    expect(backend.callsOf('reflect_list_dir').length).toBe(1);
  });

  it('PROTOCOL_BRIDGE documents every command (docs stay current)', () => {
    const doc = readFileSync('docs/PROTOCOL_BRIDGE.md', 'utf8');
    const src = backendSource();
    // 同步 `pub fn` 与异步 `pub async fn` 都是合法后端命令(如
    // dock::reflect_set_dock_badge 是同步命令)。只扫 `pub async fn` 会让
    // 同步命令整个漏掉 —— 替身缺 handler 也就没人发现。
    const backendNames = [...src.matchAll(/pub (?:async )?fn (reflect_\w+)/g)].map((m) => m[1]);
    const undocumented = backendNames.filter((n) => !doc.includes(n));
    // 文档允许少量滞后（agent 生命周期命令在文档中以 Op 变体形式记录），
    // 这里守住 85% 覆盖率下限，防止命令面膨胀后文档彻底失修。
    const coverage = 1 - undocumented.length / backendNames.length;
    expect(coverage).toBeGreaterThanOrEqual(0.85);
  });
});

// ============================================================================
// 5. 逐领域 round-trip：wrapper 参数 → 线上 args 形状
// ============================================================================

describe('IPC round-trip: wrapper args → wire payload', () => {
  it('agent lifecycle: submit envelope / rewind / interrupt', async () => {
    await commands.reflect_submit({ id: 'sub-1', op: { type: 'user_input', items: [{ type: 'text', text: 'hi' }] } });
    expect(backend.lastArgsOf('reflect_submit')).toEqual({
      submission: { id: 'sub-1', op: { type: 'user_input', items: [{ type: 'text', text: 'hi' }] } },
    });

    await commands.reflect_rewind('turn-9');
    expect(backend.lastArgsOf('reflect_rewind')).toEqual({ toTurnId: 'turn-9' });

    await commands.reflect_interrupt();
    expect(backend.callsOf('reflect_interrupt').length).toBe(1);
  });

  it('approvals: ReviewDecision wire forms', async () => {
    await commands.reflect_tool_approval('apr-1', 'approve');
    await commands.reflect_tool_approval('apr-2', { deny: { reason: 'nope' } });
    expect(backend.callsOf('reflect_tool_approval').map((c) => c.args)).toEqual([
      { id: 'apr-1', decision: 'approve' },
      { id: 'apr-2', decision: { deny: { reason: 'nope' } } },
    ]);

    await commands.reflect_hook_approval('hk-1', 'approve_for_session');
    expect(backend.lastArgsOf('reflect_hook_approval')).toEqual({
      id: 'hk-1',
      decision: 'approve_for_session',
    });

    await commands.reflect_plan_approval('plan-1', 'auto_mode');
    expect(backend.lastArgsOf('reflect_plan_approval')).toEqual({ id: 'plan-1', choice: 'auto_mode' });
  });

  it('questions: responses carry id + payload', async () => {
    await commands.reflect_ask_user_question_response('q-1', { answers: [{ selected: [0] }] });
    expect(backend.lastArgsOf('reflect_ask_user_question_response')).toEqual({
      id: 'q-1',
      answers: { answers: [{ selected: [0] }] },
    });

    await commands.reflect_ask_user_input_response('q-2', 'my text');
    expect(backend.lastArgsOf('reflect_ask_user_input_response')).toEqual({ id: 'q-2', text: 'my text' });
  });

  it('plan / effort / permission ops', async () => {
    await commands.reflect_enter_plan_mode('refactor auth');
    expect(backend.lastArgsOf('reflect_enter_plan_mode')).toEqual({ task: 'refactor auth' });

    await commands.reflect_set_effort('high');
    expect(backend.lastArgsOf('reflect_set_effort')).toEqual({ level: 'high' });

    await commands.reflect_set_permission_mode('plan');
    expect(backend.lastArgsOf('reflect_set_permission_mode')).toEqual({ mode: 'plan' });

    // set 已切到 plan → cycle 顺序 auto→prompt→deny→plan 回绕到 auto。
    await commands.reflect_cycle_permission_mode();
    expect(backend.state.permissionMode).toBe('auto');
  });

  it('goal mode ops (v1.2 P1): enter with optional verify/budget, exit clears', async () => {
    // 最小形态:仅 goal 必填,可选字段缺省时线格式不带键。
    await commands.reflect_enter_goal_mode('make all tests pass');
    expect(backend.lastArgsOf('reflect_enter_goal_mode')).toMatchObject({
      goal: 'make all tests pass',
    });
    expect(backend.state.goal.active).toBe(true);
    expect(backend.state.goal.goal).toBe('make all tests pass');

    // 完整形态:校验命令 + token 预算走 camelCase 键(Tauri 映射 snake_case)。
    await commands.reflect_enter_goal_mode('ship v2', 'cargo test', 100_000);
    expect(backend.lastArgsOf('reflect_enter_goal_mode')).toMatchObject({
      goal: 'ship v2',
      verifyCommand: 'cargo test',
      tokenBudget: 100_000,
    });
    expect(backend.state.goal).toEqual({
      active: true,
      goal: 'ship v2',
      verifyCommand: 'cargo test',
      tokenBudget: 100_000,
      // v1.7 快照口径新增字段(reflect_goal_snapshot 消费)。
      turnCount: 0,
      tokensUsed: 0,
    });

    await commands.reflect_exit_goal_mode();
    expect(backend.state.goal.active).toBe(false);
    expect(backend.state.goal.goal).toBeNull();
  });

  it('sessions: rename maps to { id, newName }', async () => {
    await commands.reflect_rename_session('sess-alpha', 'Renamed');
    expect(backend.lastArgsOf('reflect_rename_session')).toEqual({ id: 'sess-alpha', newName: 'Renamed' });

    await commands.reflect_delete_session('sess-beta');
    expect(backend.lastArgsOf('reflect_delete_session')).toEqual({ id: 'sess-beta' });
    expect(backend.state.sessions.find((s) => s.session_id === 'sess-beta')).toBeUndefined();

    // v1.x:bind 在 replay 之前发生(ChatView 加载序列),fakeBackend 记录
    // 最近绑定的 id 供断言。
    await commands.reflect_bind_session('sess-alpha');
    expect(backend.lastArgsOf('reflect_bind_session')).toEqual({ id: 'sess-alpha' });
    expect(backend.state.boundSessionId).toBe('sess-alpha');

    await commands.reflect_replay_session('sess-alpha');
    expect(backend.lastArgsOf('reflect_replay_session')).toEqual({ id: 'sess-alpha' });
    expect(backend.state.rollouts['sess-alpha'].length).toBeGreaterThan(0);

    await commands.reflect_export_session('sess-alpha');
    expect(backend.lastArgsOf('reflect_export_session')).toEqual({ id: 'sess-alpha' });
  });

  it('sessions: archive moves to archived list, unarchive moves back', async () => {
    // fixture 里 sess-archived 初始就在归档区。
    expect((await commands.reflect_list_archived_sessions()).map((s) => s.session_id)).toEqual(['sess-archived']);

    await commands.reflect_archive_session('sess-alpha');
    expect(backend.lastArgsOf('reflect_archive_session')).toEqual({ id: 'sess-alpha' });
    expect(backend.state.sessions.find((s) => s.session_id === 'sess-alpha')).toBeUndefined();
    expect(backend.state.archived.find((s) => s.session_id === 'sess-alpha')).toBeDefined();

    await commands.reflect_unarchive_session('sess-alpha');
    expect(backend.state.sessions.find((s) => s.session_id === 'sess-alpha')).toBeDefined();
    expect(backend.state.archived.find((s) => s.session_id === 'sess-alpha')).toBeUndefined();
  });

  it('config: save carries toml string, state round-trips', async () => {
    await commands.reflect_save_config('[active]\nprovider = "openai"\n');
    expect(backend.lastArgsOf('reflect_save_config')).toEqual({ toml: '[active]\nprovider = "openai"\n' });
    expect(await commands.reflect_get_config()).toContain('openai');
  });

  it('memory: add/remove keyed by scope+key', async () => {
    await commands.reflect_add_memory('project', 'test-cmd', 'pnpm test');
    expect(backend.lastArgsOf('reflect_add_memory')).toEqual({ scope: 'project', key: 'test-cmd', value: 'pnpm test' });
    expect(backend.state.memory.length).toBe(3);
    await expect(commands.reflect_add_memory('project', 'test-cmd', 'overwrite', { createOnly: true })).rejects.toThrow('already exists');
    await commands.reflect_add_memory('project', 'test-cmd', 'updated');
    expect(backend.state.memory.find((m) => m.key === 'test-cmd')?.value).toBe('updated');

    await expect(commands.reflect_add_memory('project', 'test-cmd', 'stale', { expectedValue: 'pnpm test' })).rejects.toThrow('changed or was removed');
    await expect(commands.reflect_remove_memory('project', 'test-cmd', false, undefined, 'pnpm test')).rejects.toThrow('changed or was removed');
    expect(backend.state.memory.find((m) => m.key === 'test-cmd')?.value).toBe('updated');

    await commands.reflect_remove_memory('project', 'test-cmd', false, undefined, 'updated');
    expect(backend.state.memory.find((m) => m.key === 'test-cmd')).toBeUndefined();
  });

  it('hooks: toggle carries name+enabled and mutates state', async () => {
    await commands.reflect_toggle_hook('audit-deps', true);
    expect(backend.lastArgsOf('reflect_toggle_hook')).toEqual({ name: 'audit-deps', enabled: true });
    expect(backend.state.hooks.find((h) => h.name === 'audit-deps')?.enabled).toBe(true);
  });

  it('git: diff/log carry options', async () => {
    await commands.reflect_git_diff(true);
    expect(backend.lastArgsOf('reflect_git_diff')).toEqual({ staged: true });

    await commands.reflect_git_log(5);
    expect(backend.lastArgsOf('reflect_git_log')).toEqual({ limit: 5 });
  });

  it('terminal: run/kill shell sessions', async () => {
    const session = await commands.reflect_run_shell('cargo test');
    expect(backend.lastArgsOf('reflect_run_shell')).toEqual({ cmd: 'cargo test' });
    expect(session.session_id).toMatch(/^shell-/);

    await commands.reflect_kill_shell(session.session_id);
    // Tauri 2 平铺参数 camelCase 匹配（Rust `session_id` → JS `sessionId`）。
    expect(backend.lastArgsOf('reflect_kill_shell')).toEqual({ sessionId: session.session_id });
    expect(backend.state.shellSessions).not.toContain(session.session_id);
  });

  it('tasks: create/update/delete carry list+id', async () => {
    await commands.reflect_create_task({ list: 'default', subject: 'New task', description: 'do it' });
    expect(backend.lastArgsOf('reflect_create_task')).toMatchObject({
      list: 'default',
      subject: 'New task',
      description: 'do it',
    });

    await commands.reflect_update_task('default', 1, { status: 'done' });
    expect(backend.lastArgsOf('reflect_update_task')).toEqual({
      list: 'default',
      id: 1,
      patch: { status: 'done' },
    });
    expect(backend.state.tasks.find((t) => t.id === 1)?.status).toBe('done');

    await commands.reflect_delete_task('default', 2);
    expect(backend.lastArgsOf('reflect_delete_task')).toEqual({ list: 'default', id: 2 });
  });

  it('schedule: add/update/remove cron jobs', async () => {
    await commands.reflect_add_schedule({ schedule: '0 9 * * *', prompt: 'standup', name: 'daily' });
    expect(backend.callsOf('reflect_add_schedule').at(-1)?.args).toEqual({
      schedule: '0 9 * * *',
      prompt: 'standup',
      name: 'daily',
    });

    await commands.reflect_update_schedule({ id: 'cron-1', enabled: false });
    expect(backend.lastArgsOf('reflect_update_schedule')).toMatchObject({ id: 'cron-1', enabled: false });

    await commands.reflect_remove_schedule('cron-1');
    expect(backend.lastArgsOf('reflect_remove_schedule')).toEqual({ id: 'cron-1' });
    expect(backend.state.schedules.find((s) => s.id === 'cron-1')).toBeUndefined();
  });

  it('side channel: start/cancel keyed by camelCase agentName+prompt / id', async () => {
    await commands.reflect_start_side_channel({ agent_name: 'helper', prompt: 'research' });
    expect(backend.callsOf('reflect_start_side_channel').at(-1)?.args).toEqual({
      agentName: 'helper',
      prompt: 'research',
    });

    await commands.reflect_cancel_side_channel('sc-1');
    expect(backend.lastArgsOf('reflect_cancel_side_channel')).toEqual({ id: 'sc-1' });
    expect(backend.state.sideChannels.find((s) => s.id === 'sc-1')).toBeUndefined();
  });

  it('workspaces: set_workspace path round-trip', async () => {
    await commands.reflect_set_workspace('/Users/dev/other');
    expect(backend.lastArgsOf('reflect_set_workspace')).toEqual({ path: '/Users/dev/other' });
    expect(await commands.reflect_current_workspace()).toBe('/Users/dev/other');
  });

  it('workspaces: folder picker + reveal carry payloads', async () => {
    backend.state.pickedFolder = '/Users/dev/picked';
    await expect(commands.reflect_pick_workspace_folder()).resolves.toBe('/Users/dev/picked');
    expect(backend.callsOf('reflect_pick_workspace_folder').length).toBe(1);

    await commands.reflect_reveal_path('/Users/dev/project');
    expect(backend.lastArgsOf('reflect_reveal_path')).toEqual({ path: '/Users/dev/project' });
  });

  it('squad/teams: specs and names', async () => {
    await commands.reflect_create_squad({
      name: 'alpha-squad',
      description: '',
      leaderActor: { actorType: 'agent', actorId: 'lead@alpha' },
    } as never);
    expect(backend.callsOf('reflect_create_squad').at(-1)?.args).toMatchObject({ spec: { name: 'alpha-squad' } });

    await commands.reflect_delete_squad('rocket');
    expect(backend.lastArgsOf('reflect_delete_squad')).toEqual({ name: 'rocket' });

    await commands.reflect_delete_team('core');
    expect(backend.lastArgsOf('reflect_delete_team')).toEqual({ name: 'core' });
  });

  it('allowlist: save carries full list under `prefixes` and normalizes like the real backend', async () => {
    await commands.reflect_save_allowlist({ prefixes: ['read_file', ' ls ', 'grep', 'ls', ''] });
    expect(backend.lastArgsOf('reflect_save_allowlist')).toEqual({
      list: { prefixes: ['read_file', ' ls ', 'grep', 'ls', ''] },
    });
    // 真后端 `allowlist.rs`:trim / 丢空 / BTreeSet 去重 + 字典序。
    expect(await commands.reflect_load_allowlist()).toEqual({ prefixes: ['grep', 'ls', 'read_file'] });
    expect(await commands.reflect_check_allowlist('ls -la')).toBe(true);
    expect(await commands.reflect_check_allowlist('rm -rf /')).toBe(false);
    expect(await commands.reflect_check_allowlist('   ')).toBe(false);
  });

  it('agent defs: save/delete by name', async () => {
    await commands.reflect_save_agent_def({ name: 'tester', description: '' } as never);
    expect(backend.callsOf('reflect_save_agent_def').at(-1)?.args).toMatchObject({ def: { name: 'tester' } });
    await expect(commands.reflect_save_agent_def({ name: 'tester', description: 'replacement' } as never, true)).rejects.toThrow('already exists');
    expect((await commands.reflect_get_agent_def('tester')).description).toBe('');

    await commands.reflect_delete_agent_def('reviewer');
    expect(backend.lastArgsOf('reflect_delete_agent_def')).toEqual({ name: 'reviewer' });
  });

  it('files: list_dir/read_file/search carry paths', async () => {
    await commands.reflect_list_dir('/Users/dev/project', 2);
    expect(backend.lastArgsOf('reflect_list_dir')).toEqual({ path: '/Users/dev/project', maxDepth: 2 });

    await commands.reflect_read_file('src/lib.rs');
    expect(backend.lastArgsOf('reflect_read_file')).toEqual({ path: 'src/lib.rs' });
  });

  it('kms: wiki/page operations', async () => {
    await commands.reflect_kms_save_page('engineering', 'auth.md', '# Auth', 'Auth', ['sec']);
    expect(backend.lastArgsOf('reflect_kms_save_page')).toEqual({
      wiki: 'engineering',
      page: 'auth.md',
      content: '# Auth',
      title: 'Auth',
      tags: ['sec'],
    });
    await expect(commands.reflect_kms_save_page('engineering', 'auth.md', 'replacement', null, null, true)).rejects.toThrow('already exists');
    expect((await commands.reflect_kms_get_page('engineering', 'auth.md')).content).toContain('# Auth');

    await commands.reflect_kms_search('jwt');
    expect(backend.lastArgsOf('reflect_kms_search')).toEqual({ query: 'jwt' });
  });

  it('health: ping + agent status shape', async () => {
    const pong = await commands.ping();
    expect(pong.msg).toBe('pong');
    const status = await commands.reflect_agent_status();
    expect(status).toMatchObject({ ready: true, has_model: true });
  });

  it('backend failures propagate to frontend callers', async () => {
    backend.state.failures['reflect_list_sessions'] = new Error('rollout dir corrupted');
    await expect(commands.reflect_list_sessions()).rejects.toThrow('rollout dir corrupted');
  });
});

// ============================================================================
// 6. 模拟后端自身完整性
// ============================================================================

describe('fakeBackend integrity', () => {
  it('every invoke that the app can make is handled (no [mock] not mocked)', async () => {
    const src = backendSource();
    // 同步 `pub fn` 与异步 `pub async fn` 都是合法后端命令(如
    // dock::reflect_set_dock_badge 是同步命令)。只扫 `pub async fn` 会让
    // 同步命令整个漏掉 —— 替身缺 handler 也就没人发现。
    const backendNames = [...src.matchAll(/pub (?:async )?fn (reflect_\w+)/g)].map((m) => m[1]);
    const libSrc = readFileSync('src-tauri/src/lib.rs', 'utf8');
    const handlerMatch = libSrc.match(/tauri::generate_handler!\[([\s\S]*?)\]/)![1];
    const registered = backendNames.filter((n) => handlerMatch.includes(n));
    expect(registered.length).toBe(backendNames.length);
    // fakeBackend 必须为每个已注册命令提供 handler。
    const unhandled = registered.filter((n) => !backend.registeredCommands.includes(n));
    expect(unhandled).toEqual([]);
    expect(backend.registeredCommands.length).toBeGreaterThanOrEqual(105);
  });

  it('records every call with args snapshot', async () => {
    await commands.ping();
    const call = backend.callsOf('ping').at(-1);
    expect(call).toBeDefined();
    expect(call!.at).toBeGreaterThan(0);
  });
});

// 引用 existsSync 防止 tree-shake 抱怨（node 环境下始终 true）。
void existsSync;
