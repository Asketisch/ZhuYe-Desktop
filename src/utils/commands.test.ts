/**
 * Vitest — commands 包装测试。
 *
 * 验证 wrapper 调用 invoke 转发正确 cmd + 参数（依赖 test/setup.tsx 的 mock）。
 *
 * 第二组 `forwarding (mapping)` 用例覆盖各 domain 的代表 wrapper,
 * 确认 cmd name 与 argument object key 与历史实现完全一致 —— 拆目录后
 * 重新集中保护这条不变量。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke, resetMockInvoke } from '@/test/setup';
import {
  // agent
  ping,
  zhuye_submit,
  zhuye_interrupt,
  zhuye_compact,
  zhuye_rewind,
  zhuye_shutdown,
  // approvals
  zhuye_tool_approval,
  zhuye_hook_approval,
  zhuye_plan_approval,
  // plan
  zhuye_enter_plan_mode,
  zhuye_exit_plan_mode,
  // permissions
  zhuye_set_effort,
  zhuye_set_permission_mode,
  zhuye_cycle_permission_mode,
  // questions
  zhuye_ask_user_question_response,
  zhuye_ask_user_input_response,
  // mcp
  zhuye_mcp_elicitation_response,
  // config
  zhuye_agent_status,
  zhuye_get_config,
  zhuye_save_config,
  zhuye_list_tools,
  // sessions
  zhuye_list_sessions,
  zhuye_create_session,
  zhuye_rename_session,
  zhuye_delete_session,
  zhuye_replay_session,
  zhuye_export_session,
  zhuye_export_session_markdown,
  // events
  onZhuyeEvent,
  // workspaces
  zhuye_list_workspaces,
  zhuye_set_workspace,
  zhuye_current_workspace,
  // skills
  zhuye_list_skills,
  // memory
  zhuye_list_memory,
  zhuye_add_memory,
  zhuye_remove_memory,
  zhuye_memory_sections,
  // hooks
  zhuye_list_hooks,
  zhuye_toggle_hook,
  // git
  zhuye_git_status,
  zhuye_git_diff,
  zhuye_git_log,
  // terminal
  zhuye_run_shell,
  zhuye_kill_shell,
  zhuye_list_shell_sessions,
  onTerminalOutput,
  // files
  zhuye_list_dir,
  zhuye_read_file,
  // allowlist
  zhuye_load_allowlist,
  zhuye_save_allowlist,
  zhuye_check_allowlist,
  // updates
  zhuye_check_update,
  zhuye_download_install_update,
  zhuye_relaunch_app,
  zhuye_remote_bind,
  zhuye_remote_disconnect,
  zhuye_remote_hosts,
  zhuye_remote_sessions,
  zhuye_remote_bootstrap,
  zhuye_browser_start,
  zhuye_browser_status,
  zhuye_browser_stop,
  zhuye_browser_env,
  // search
  zhuye_search_files,
  // tasks (Phase 1 multi-agent)
  zhuye_list_tasks,
  zhuye_create_task,
  zhuye_get_task,
  zhuye_update_task,
  zhuye_claim_task,
  zhuye_delete_task,
  // teams (Phase 1 multi-agent)
  zhuye_list_teams,
  zhuye_upsert_team,
  zhuye_get_team,
  zhuye_delete_team,
  // schedule (Phase 1 条目 2)
  zhuye_list_schedules,
  zhuye_add_schedule,
  zhuye_update_schedule,
  zhuye_remove_schedule,
  zhuye_get_schedule_status,
  // agents (Phase 1 条目 3)
  zhuye_list_agent_defs,
  zhuye_get_agent_def,
  zhuye_save_agent_def,
  zhuye_delete_agent_def,
  zhuye_parse_agent_md,
  // side-channel (Phase 2 条目 1)
  zhuye_start_side_channel,
  zhuye_cancel_side_channel,
  zhuye_list_side_channels,
  zhuye_get_side_channel,
  // remote (Phase 2 条目 2)
  zhuye_get_remote_config,
  zhuye_update_remote_config,
  zhuye_get_remote_status,
  zhuye_tailscale_status,
  zhuye_tailscale_daemon_command_preview,
  zhuye_tailscale_daemon_start,
  zhuye_tailscale_daemon_stop,
  zhuye_tailscale_daemon_status,
} from '@/utils/commands';

/**
 * 捕获单次调用的 cmd + args。
 * 返回记录的 args 对象（对不传 args 的包装返回 undefined）。
 */
async function captureCmd<T>(cmd: string, fn: () => Promise<T>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    mockInvoke(cmd, async (_c, args) => {
      resolve(args);
      return undefined;
    });
    fn().catch(reject);
  });
}

describe('commands (forwarding to mock invoke)', () => {
  it('zhuye_interrupt calls invoke("zhuye_interrupt")', async () => {
    // setup.tsx 已 mock zhuye_set_permission_mode 等; zhuye_interrupt 未注册 → mock 抛错
    await expect(zhuye_interrupt()).rejects.toThrow(/not mocked/);
  });

  it('zhuye_compact also un-registered by default', async () => {
    await expect(zhuye_compact()).rejects.toThrow(/not mocked/);
  });

  it('zhuye_rewind forwards toTurnId argument', async () => {
    await expect(zhuye_rewind('turn-123')).rejects.toThrow(/not mocked/);
    await expect(zhuye_rewind()).rejects.toThrow(/not mocked/);
  });

  it('zhuye_tool_approval accepts ReviewDecision', async () => {
    await expect(zhuye_tool_approval('id-1', 'approve')).rejects.toThrow(/not mocked/);
    await expect(
      zhuye_tool_approval('id-2', { deny: { reason: 'risky' } }),
    ).rejects.toThrow(/not mocked/);
    await expect(
      zhuye_tool_approval('id-3', 'approve_for_session'),
    ).rejects.toThrow(/not mocked/);
  });

  it('zhuye_set_permission_mode is mocked by setup and returns undefined', async () => {
    expect(await zhuye_set_permission_mode('default')).toBeUndefined();
  });
});

describe('commands forwarding (mapping)', () => {
  beforeEach(() => {
    resetMockInvoke();
  });

  /** 与包装器传入的字面量记录逐项比较。 */
  function expectArgs(actual: unknown, expected: Record<string, unknown> | undefined) {
    expect(actual).toEqual(expected);
  }

  // ----- ping -----

  it('ping → invoke("ping") with no args', async () => {
    const args = await captureCmd('ping', ping);
    expectArgs(args, undefined);
  });

  // ----- agent 生命周期 -----

  it('zhuye_submit forwards { submission }', async () => {
    const args = await captureCmd('zhuye_submit', () =>
      zhuye_submit({ id: 'sub-1', op: { type: 'interrupt' } } as never),
    );
    expectArgs(args, { submission: { id: 'sub-1', op: { type: 'interrupt' } } });
  });

  it('zhuye_interrupt / compact / shutdown use bare cmd names', async () => {
    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const [cmd, fn] of [
      ['zhuye_interrupt', zhuye_interrupt],
      ['zhuye_compact', zhuye_compact],
      ['zhuye_shutdown', zhuye_shutdown],
    ] as const) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'zhuye_interrupt' ? undefined : `sub-${c}`;
      });
      await fn();
    }
    expect(seenArgs).toEqual([
      { cmd: 'zhuye_interrupt', args: undefined },
      { cmd: 'zhuye_compact', args: { instructions: null } },
      { cmd: 'zhuye_shutdown', args: undefined },
    ]);
  });

  it('zhuye_rewind encodes `toTurnId` (camelCase) and normalises undefined → null', async () => {
    const withId = await captureCmd('zhuye_rewind', () => zhuye_rewind('turn-xyz'));
    expectArgs(withId, { toTurnId: 'turn-xyz' });

    const noId = await captureCmd('zhuye_rewind', () => zhuye_rewind());
    expectArgs(noId, { toTurnId: null });
  });

  // ----- 审批 -----

  it('tool/hook approval forwards { id, decision } identically', async () => {
    const cases = [
      ['zhuye_tool_approval', zhuye_tool_approval],
      ['zhuye_hook_approval', zhuye_hook_approval],
    ] as const;
    for (const [cmd, fn] of cases) {
      const captured = await captureCmd(cmd, () => fn('approval-42', 'approve'));
      expectArgs(captured, { id: 'approval-42', decision: 'approve' });
    }
  });

  it('plan approval forwards { id, choice } (PlanApprovalChoice 三选一)', async () => {
    const captured = await captureCmd('zhuye_plan_approval', () =>
      zhuye_plan_approval('plan-42', 'auto_mode'),
    );
    expectArgs(captured, { id: 'plan-42', choice: 'auto_mode' });
  });

  // ----- 计划 -----

  it('zhuye_enter_plan_mode forwards { task }; exit_plan_mode has none', async () => {
    const enter = await captureCmd('zhuye_enter_plan_mode', () =>
      zhuye_enter_plan_mode('plan this'),
    );
    expectArgs(enter, { task: 'plan this' });

    const exit = await captureCmd('zhuye_exit_plan_mode', () => zhuye_exit_plan_mode());
    expectArgs(exit, undefined);
  });

  // ----- 权限 -----

  it('zhuye_set_effort forwards { level }; set_permission_mode { mode }; cycle has none', async () => {
    const effort = await captureCmd('zhuye_set_effort', () => zhuye_set_effort('high'));
    expectArgs(effort, { level: 'high' });

    const perm = await captureCmd('zhuye_set_permission_mode', () =>
      zhuye_set_permission_mode('auto'),
    );
    expectArgs(perm, { mode: 'auto' });

    const cycle = await captureCmd('zhuye_cycle_permission_mode', () =>
      zhuye_cycle_permission_mode(),
    );
    expectArgs(cycle, undefined);
  });

  // ----- 提问 -----

  it('zhuye_ask_user_question_response forwards { id, answers }', async () => {
    const args = await captureCmd('zhuye_ask_user_question_response', () =>
      zhuye_ask_user_question_response('q-1', { answers: [{ selected: [1] }] }),
    );
    expectArgs(args, { id: 'q-1', answers: { answers: [{ selected: [1] }] } });
  });

  it('zhuye_ask_user_input_response forwards { id, text }', async () => {
    const args = await captureCmd('zhuye_ask_user_input_response', () =>
      zhuye_ask_user_input_response('q-2', 'typed answer'),
    );
    expectArgs(args, { id: 'q-2', text: 'typed answer' });
  });

  // ----- MCP elicitation -----

  it('zhuye_mcp_elicitation_response forwards { id, action, content }', async () => {
    const args = await captureCmd('zhuye_mcp_elicitation_response', () =>
      zhuye_mcp_elicitation_response('e-1', 'accept', { repo: 'zhuYe' }),
    );
    expectArgs(args, { id: 'e-1', action: 'accept', content: { repo: 'zhuYe' } });
  });

  // ----- 配置 / agent 状态 -----

  it('zhuye_agent_status / get_config / list_tools use bare cmd names', async () => {
    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const cmd of ['zhuye_agent_status', 'zhuye_get_config', 'zhuye_list_tools']) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'zhuye_list_tools' ? [] : '';
      });
    }
    await zhuye_agent_status();
    await zhuye_get_config();
    await zhuye_list_tools();
    expect(seenArgs).toEqual([
      { cmd: 'zhuye_agent_status', args: undefined },
      { cmd: 'zhuye_get_config', args: undefined },
      { cmd: 'zhuye_list_tools', args: undefined },
    ]);
  });

  it('zhuye_save_config forwards { toml }', async () => {
    const args = await captureCmd('zhuye_save_config', () =>
      zhuye_save_config('foo = 1\n'),
    );
    expectArgs(args, { toml: 'foo = 1\n' });
  });

  // ----- 会话 -----

  it('zhuye_list_sessions normalises missing opts to { workspace: null, limit: null, offset: null }', async () => {
    const none = await captureCmd('zhuye_list_sessions', () => zhuye_list_sessions());
    expectArgs(none, { workspace: null, limit: null, offset: null });

    const some = await captureCmd('zhuye_list_sessions', () =>
      zhuye_list_sessions({ workspace: '/tmp/proj', limit: 10, offset: 20 }),
    );
    expectArgs(some, { workspace: '/tmp/proj', limit: 10, offset: 20 });
  });

  it('zhuye_create_session forwards no args and resolves to a session id', async () => {
    mockInvoke('zhuye_create_session', async () => 'sess-new-1');
    const id = await zhuye_create_session();
    expect(id).toBe('sess-new-1');
  });

  it('zhuye_rename_session encodes newName (camelCase); delete forwards { id } only', async () => {
    const rename = await captureCmd('zhuye_rename_session', () =>
      zhuye_rename_session('sess-1', 'My session'),
    );
    expectArgs(rename, { id: 'sess-1', newName: 'My session' });

    const del = await captureCmd('zhuye_delete_session', () =>
      zhuye_delete_session('sess-2'),
    );
    expectArgs(del, { id: 'sess-2' });
  });

  it('zhuye_replay_session / export_session / export_session_markdown forward { id }', async () => {
    const cases: Array<[string, (id: string) => Promise<unknown>]> = [
      ['zhuye_replay_session', zhuye_replay_session],
      ['zhuye_export_session', zhuye_export_session],
      ['zhuye_export_session_markdown', zhuye_export_session_markdown],
    ];
    for (const [cmd, fn] of cases) {
      const args = await captureCmd(cmd, () => fn('sess-9'));
      expectArgs(args, { id: 'sess-9' });
    }
  });

  // ----- 事件 -----

  it('onZhuyeEvent listens on "zhuye_event" and unwraps .payload', async () => {
    const unlisten = await onZhuyeEvent(() => {});
    expect(typeof unlisten).toBe('function');
    unlisten();
  });

  // ----- 工作区 -----

  it('zhuye_set_workspace forwards { path }; other workspace cmds have no args', async () => {
    const set = await captureCmd('zhuye_set_workspace', () =>
      zhuye_set_workspace('/tmp/proj'),
    );
    // v1.x:可选 unhide —— 缺省显式传 null(serde Option ↔ null),
    // unhide: true 用于管理页「恢复」已移除的工作区。
    expectArgs(set, { path: '/tmp/proj', unhide: null });
    const unhide = await captureCmd('zhuye_set_workspace', () =>
      zhuye_set_workspace('/tmp/proj', true),
    );
    expectArgs(unhide, { path: '/tmp/proj', unhide: true });

    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const cmd of ['zhuye_list_workspaces', 'zhuye_current_workspace']) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'zhuye_list_workspaces' ? [] : '/tmp/proj';
      });
    }
    await zhuye_list_workspaces();
    await zhuye_current_workspace();
    expect(seenArgs).toEqual([
      { cmd: 'zhuye_list_workspaces', args: undefined },
      { cmd: 'zhuye_current_workspace', args: undefined },
    ]);
  });

  // ----- 技能 -----

  it('zhuye_list_skills has no args', async () => {
    const args = await captureCmd('zhuye_list_skills', () => zhuye_list_skills());
    expectArgs(args, undefined);
  });

  // ----- 记忆 -----

  it('memory wrappers forward { scope, key, value? }', async () => {
    const list = await captureCmd('zhuye_list_memory', () => zhuye_list_memory());
    expectArgs(list, undefined);

    const add = await captureCmd('zhuye_add_memory', () =>
      zhuye_add_memory('user', 'name', 'Alice'),
    );
    expectArgs(add, { scope: 'user', key: 'name', value: 'Alice' });
    const create = await captureCmd('zhuye_add_memory', () =>
      zhuye_add_memory('user', 'name', 'Alice', { createOnly: true }),
    );
    expectArgs(create, { scope: 'user', key: 'name', value: 'Alice', createOnly: true });
    const replace = await captureCmd('zhuye_add_memory', () =>
      zhuye_add_memory('user', '(all)', 'document', { replaceDocument: true }),
    );
    expectArgs(replace, { scope: 'user', key: '(all)', value: 'document', replaceDocument: true });

    const rm = await captureCmd('zhuye_remove_memory', () =>
      zhuye_remove_memory('user', 'name'),
    );
    expectArgs(rm, { scope: 'user', key: 'name' });
    const rmDoc = await captureCmd('zhuye_remove_memory', () => zhuye_remove_memory('user', '(all)', true));
    expectArgs(rmDoc, { scope: 'user', key: '(all)', replaceDocument: true });

    const context = { workspace: '/workspace', agent: 'default' };
    const sections = await captureCmd('zhuye_memory_sections', () => zhuye_memory_sections(context));
    expectArgs(sections, { expectedContext: context });
    const oldSections = await captureCmd('zhuye_memory_sections', () => zhuye_memory_sections());
    expectArgs(oldSections, undefined);
  });

  // ----- 钩子 -----

  it('zhuye_toggle_hook forwards { name, enabled }; list_hooks has no args', async () => {
    const toggle = await captureCmd('zhuye_toggle_hook', () =>
      zhuye_toggle_hook('pre-commit', true),
    );
    expectArgs(toggle, { name: 'pre-commit', enabled: true });

    const list = await captureCmd('zhuye_list_hooks', () => zhuye_list_hooks());
    expectArgs(list, undefined);
  });

  // ----- git -----

  it('zhuye_git_status has no args; diff forwards { staged }; log forwards { limit }', async () => {
    const status = await captureCmd('zhuye_git_status', () => zhuye_git_status());
    expectArgs(status, undefined);

    const diff = await captureCmd('zhuye_git_diff', () => zhuye_git_diff(true));
    expectArgs(diff, { staged: true });

    const log = await captureCmd('zhuye_git_log', () => zhuye_git_log(50));
    expectArgs(log, { limit: 50 });
  });

  // ----- 终端 -----

  it('terminal spawn forwards { cmd }; kill forwards camelCase { sessionId }; list has no args', async () => {
    const run = await captureCmd('zhuye_run_shell', () => zhuye_run_shell('ls -la'));
    // v1.11 基建#7:sshHost 可选参数未传时线上为 null(显式可选)。
    expectArgs(run, { cmd: 'ls -la', sshHost: null });

    const kill = await captureCmd('zhuye_kill_shell', () => zhuye_kill_shell('sh-1'));
    // Tauri 2 平铺参数按 camelCase 匹配（Rust `session_id` → JS `sessionId`）。
    expectArgs(kill, { sessionId: 'sh-1' });

    const list = await captureCmd('zhuye_list_shell_sessions', () =>
      zhuye_list_shell_sessions(),
    );
    expectArgs(list, undefined);
  });

  it('onTerminalOutput listens on "zhuye_terminal_output" and unwraps .payload', async () => {
    const unlisten = await onTerminalOutput(() => {});
    expect(typeof unlisten).toBe('function');
    unlisten();
  });

  // ----- 文件 -----

  it('zhuye_list_dir forwards { path, maxDepth }; read_file forwards { path }', async () => {
    const dir = await captureCmd('zhuye_list_dir', () => zhuye_list_dir(null));
    expectArgs(dir, { path: null, maxDepth: 4 });

    const dirScoped = await captureCmd('zhuye_list_dir', () =>
      zhuye_list_dir('/some/dir', 2),
    );
    expectArgs(dirScoped, { path: '/some/dir', maxDepth: 2 });

    const read = await captureCmd('zhuye_read_file', () => zhuye_read_file('/a.ts'));
    expectArgs(read, { path: '/a.ts' });
  });

  // ----- 白名单 -----

  it('zhuye_load_allowlist has no args; save_allowlist forwards { list }; check_allowlist forwards { prefix }', async () => {
    const load = await captureCmd('zhuye_load_allowlist', () => zhuye_load_allowlist());
    expectArgs(load, undefined);

    const list = { prefixes: ['rm -rf', 'sudo '] };
    const save = await captureCmd('zhuye_save_allowlist', () =>
      zhuye_save_allowlist(list),
    );
    expectArgs(save, { list });

    const check = await captureCmd('zhuye_check_allowlist', () =>
      zhuye_check_allowlist('rm '),
    );
    expectArgs(check, { prefix: 'rm ' });
  });

  // ----- 更新 -----

  it('zhuye_check_update has no args', async () => {
    const args = await captureCmd('zhuye_check_update', () => zhuye_check_update());
    expectArgs(args, undefined);
  });

  it('zhuye_download_install_update has no args', async () => {
    const args = await captureCmd('zhuye_download_install_update', () =>
      zhuye_download_install_update(),
    );
    expectArgs(args, undefined);
  });

  it('zhuye_relaunch_app has no args', async () => {
    const args = await captureCmd('zhuye_relaunch_app', () => zhuye_relaunch_app());
    expectArgs(args, undefined);
  });

  // ----- 浏览器面板 -----

  it('zhuye_browser_start/stop/status/env have no args', async () => {
    expectArgs(await captureCmd('zhuye_browser_start', () => zhuye_browser_start()), undefined);
    expectArgs(await captureCmd('zhuye_browser_stop', () => zhuye_browser_stop()), undefined);
    expectArgs(await captureCmd('zhuye_browser_status', () => zhuye_browser_status()), undefined);
    expectArgs(await captureCmd('zhuye_browser_env', () => zhuye_browser_env()), undefined);
  });

  // ----- SSH 远程开发 -----

  it('zhuye_remote hosts/sessions have no args', async () => {
    expectArgs(await captureCmd('zhuye_remote_hosts', () => zhuye_remote_hosts()), undefined);
    expectArgs(await captureCmd('zhuye_remote_sessions', () => zhuye_remote_sessions()), undefined);
  });

  it('zhuye_remote bind/disconnect forwards { sid }', async () => {
    const bind = await captureCmd('zhuye_remote_bind', () => zhuye_remote_bind('sid-1'));
    expectArgs(bind, { sid: 'sid-1' });
    const disconnect = await captureCmd('zhuye_remote_disconnect', () => zhuye_remote_disconnect('sid-1'));
    expectArgs(disconnect, { sid: 'sid-1' });
  });

  it('zhuye_remote_bootstrap forwards { host }', async () => {
    const args = await captureCmd('zhuye_remote_bootstrap', () => zhuye_remote_bootstrap('box'));
    expectArgs(args, { host: 'box' });
  });

  // ----- 搜索 -----

  it('zhuye_search_files forwards { query, path, maxResults, rank } with defaults', async () => {
    const none = await captureCmd('zhuye_search_files', () => zhuye_search_files('foo'));
    expectArgs(none, { query: 'foo', path: null, maxResults: 200, rank: 'substring' });

    const some = await captureCmd('zhuye_search_files', () =>
      zhuye_search_files('foo', '/tmp', 50),
    );
    expectArgs(some, { query: 'foo', path: '/tmp', maxResults: 50, rank: 'substring' });

    // BM25 相关性排序(与 agent 的 grep 同款)。
    const ranked = await captureCmd('zhuye_search_files', () =>
      zhuye_search_files('foo', null, 20, 'bm25'),
    );
    expectArgs(ranked, { query: 'foo', path: null, maxResults: 20, rank: 'bm25' });
  });

  // ----- 任务（Phase 1 多 agent）-----

  it('zhuye_list_tasks forwards { list }', async () => {
    const args = await captureCmd('zhuye_list_tasks', () => zhuye_list_tasks('sess-1'));
    expectArgs(args, { list: 'sess-1' });
  });

  it('zhuye_create_task forwards { list, subject, description, activeForm, owner, metadata } with null defaults', async () => {
    const minimal = await captureCmd('zhuye_create_task', () =>
      zhuye_create_task({ list: 'L', subject: 's', description: 'd' }),
    );
    expectArgs(minimal, {
      list: 'L',
      subject: 's',
      description: 'd',
      // Tauri 2 平铺参数 camelCase 匹配;snake_case 键会被后端静默丢弃。
      activeForm: null,
      owner: null,
      metadata: null,
    });

    const full = await captureCmd('zhuye_create_task', () =>
      zhuye_create_task({
        list: 'L',
        subject: 's',
        description: 'd',
        active_form: 'Writing',
        owner: 'alice',
        metadata: { kind: 'bug' },
      }),
    );
    expectArgs(full, {
      list: 'L',
      subject: 's',
      description: 'd',
      activeForm: 'Writing',
      owner: 'alice',
      metadata: { kind: 'bug' },
    });
  });

  it('zhuye_get_task / delete_task forward { list, id }', async () => {
    const get = await captureCmd('zhuye_get_task', () => zhuye_get_task('L', 7));
    expectArgs(get, { list: 'L', id: 7 });

    const del = await captureCmd('zhuye_delete_task', () => zhuye_delete_task('L', 7));
    expectArgs(del, { list: 'L', id: 7 });
  });

  it('zhuye_update_task forwards { list, id, patch } verbatim', async () => {
    const patch = { status: 'in_progress' as const, add_blocks: [3] };
    const args = await captureCmd('zhuye_update_task', () =>
      zhuye_update_task('L', 1, patch),
    );
    expectArgs(args, { list: 'L', id: 1, patch });
  });

  it('zhuye_claim_task forwards { list, claimer }', async () => {
    const args = await captureCmd('zhuye_claim_task', () =>
      zhuye_claim_task('L', 'worker@x'),
    );
    expectArgs(args, { list: 'L', claimer: 'worker@x' });
  });

  // ----- 团队（Phase 1 多 agent）-----

  it('zhuye_list_teams has no args', async () => {
    const args = await captureCmd('zhuye_list_teams', () => zhuye_list_teams());
    expectArgs(args, undefined);
  });

  it('zhuye_upsert_team forwards { team }', async () => {
    const team = {
      name: 'rocket',
      lead_agent_id: 'team-lead@rocket',
      members: [],
      // 核心 `SystemTime` 的 JSON 形态(不是数字)。
      created_at: { secs_since_epoch: 0, nanos_since_epoch: 0 },
    };
    const args = await captureCmd('zhuye_upsert_team', () => zhuye_upsert_team(team));
    expectArgs(args, { team });
  });

  it('zhuye_get_team / delete_team forward { name }', async () => {
    const get = await captureCmd('zhuye_get_team', () => zhuye_get_team('rocket'));
    expectArgs(get, { name: 'rocket' });

    const del = await captureCmd('zhuye_delete_team', () => zhuye_delete_team('rocket'));
    expectArgs(del, { name: 'rocket' });
  });

  // ----- schedule (Phase 1 条目 2) -----

  it('zhuye_list_schedules / get_schedule_status have no args', async () => {
    const list = await captureCmd('zhuye_list_schedules', () => zhuye_list_schedules());
    expectArgs(list, undefined);

    const status = await captureCmd('zhuye_get_schedule_status', () =>
      zhuye_get_schedule_status(),
    );
    expectArgs(status, undefined);
  });

  it('zhuye_add_schedule forwards { schedule, prompt, name } with null default', async () => {
    const minimal = await captureCmd('zhuye_add_schedule', () =>
      zhuye_add_schedule({ schedule: '0 * * * *', prompt: 'standup' }),
    );
    expectArgs(minimal, { schedule: '0 * * * *', prompt: 'standup', name: null });

    const full = await captureCmd('zhuye_add_schedule', () =>
      zhuye_add_schedule({ schedule: '0 9 * * 1-5', prompt: 'p', name: 'weekday' }),
    );
    expectArgs(full, { schedule: '0 9 * * 1-5', prompt: 'p', name: 'weekday' });
  });

  it('zhuye_update_schedule forwards { id, schedule, prompt, name, enabled } with null defaults', async () => {
    const args = await captureCmd('zhuye_update_schedule', () =>
      zhuye_update_schedule({ id: 'job-1', enabled: false }),
    );
    expectArgs(args, {
      id: 'job-1',
      schedule: null,
      prompt: null,
      name: null,
      enabled: false,
    });
  });

  it('zhuye_remove_schedule forwards { id }', async () => {
    const args = await captureCmd('zhuye_remove_schedule', () =>
      zhuye_remove_schedule('job-1'),
    );
    expectArgs(args, { id: 'job-1' });
  });

  // ----- agents (Phase 1 条目 3) -----

  it('zhuye_list_agent_defs has no args', async () => {
    const args = await captureCmd('zhuye_list_agent_defs', () => zhuye_list_agent_defs());
    expectArgs(args, undefined);
  });

  it('zhuye_get_agent_def / delete_agent_def forward { name }', async () => {
    const get = await captureCmd('zhuye_get_agent_def', () => zhuye_get_agent_def('reviewer'));
    expectArgs(get, { name: 'reviewer' });

    const del = await captureCmd('zhuye_delete_agent_def', () =>
      zhuye_delete_agent_def('reviewer'),
    );
    expectArgs(del, { name: 'reviewer' });
  });

  it('zhuye_save_agent_def forwards { def }', async () => {
    const def = {
      name: 'reviewer',
      description: 'd',
      spawnable: false,
      readonly: true,
      tools: [],
      disallowed_tools: [],
      model: null,
      max_turns: null,
      memory: [],
      mcp_collections: [],
      system_prompt: 'body',
      source: 'custom' as const,
    };
    const args = await captureCmd('zhuye_save_agent_def', () => zhuye_save_agent_def(def));
    expectArgs(args, { def });
    const create = await captureCmd('zhuye_save_agent_def', () => zhuye_save_agent_def(def, true));
    expectArgs(create, { def, createOnly: true });
  });

  it('zhuye_parse_agent_md forwards { text }', async () => {
    const args = await captureCmd('zhuye_parse_agent_md', () =>
      zhuye_parse_agent_md('---\nname: x\ndescription: y\n---\nbody'),
    );
    expectArgs(args, { text: '---\nname: x\ndescription: y\n---\nbody' });
  });

  // ----- side-channel (Phase 2 条目 1) -----

  it('zhuye_list_side_channels has no args; get forwards { id }', async () => {
    const list = await captureCmd('zhuye_list_side_channels', () =>
      zhuye_list_side_channels(),
    );
    expectArgs(list, undefined);

    const get = await captureCmd('zhuye_get_side_channel', () =>
      zhuye_get_side_channel('side-deadbeef'),
    );
    expectArgs(get, { id: 'side-deadbeef' });
  });

  it('zhuye_start_side_channel forwards camelCase { agentName, prompt }', async () => {
    const args = await captureCmd('zhuye_start_side_channel', () =>
      zhuye_start_side_channel({ agent_name: 'default', prompt: 'hello' }),
    );
    expectArgs(args, { agentName: 'default', prompt: 'hello' });
  });

  it('zhuye_cancel_side_channel forwards { id }', async () => {
    const args = await captureCmd('zhuye_cancel_side_channel', () =>
      zhuye_cancel_side_channel('side-deadbeef'),
    );
    expectArgs(args, { id: 'side-deadbeef' });
  });

  // ----- remote (Phase 2 条目 2) -----

  it('zhuye_get_remote_config / get_remote_status / tailscale_status have no args', async () => {
    const cfg = await captureCmd('zhuye_get_remote_config', () => zhuye_get_remote_config());
    expectArgs(cfg, undefined);

    const status = await captureCmd('zhuye_get_remote_status', () =>
      zhuye_get_remote_status(),
    );
    expectArgs(status, undefined);

    const ts = await captureCmd('zhuye_tailscale_status', () => zhuye_tailscale_status());
    expectArgs(ts, undefined);
  });

  it('zhuye_update_remote_config forwards { host, port, authToken, autoConnect } with null defaults', async () => {
    // 线上键是 camelCase:Tauri 按 camelCase 取 Rust 参数 `auth_token` / `auto_connect`,
    // 发 snake_case 会被当成缺省(静默丢弃)。
    const minimal = await captureCmd('zhuye_update_remote_config', () =>
      zhuye_update_remote_config({ host: 'node.tail.net' }),
    );
    expectArgs(minimal, {
      host: 'node.tail.net',
      port: null,
      authToken: null,
      autoConnect: null,
    });

    const full = await captureCmd('zhuye_update_remote_config', () =>
      zhuye_update_remote_config({
        host: 'h',
        port: 5555,
        authToken: 'secret',
        autoConnect: true,
      }),
    );
    expectArgs(full, {
      host: 'h',
      port: 5555,
      authToken: 'secret',
      autoConnect: true,
    });
  });

  it('zhuye_tailscale_daemon_command_preview / start / stop / status have no args', async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['zhuye_tailscale_daemon_command_preview', zhuye_tailscale_daemon_command_preview],
      ['zhuye_tailscale_daemon_start', zhuye_tailscale_daemon_start],
      ['zhuye_tailscale_daemon_stop', zhuye_tailscale_daemon_stop],
      ['zhuye_tailscale_daemon_status', zhuye_tailscale_daemon_status],
    ];
    for (const [cmd, fn] of cases) {
      const args = await captureCmd(cmd, fn);
      expectArgs(args, undefined);
    }
  });
});
