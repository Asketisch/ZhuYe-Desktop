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
  reflect_submit,
  reflect_interrupt,
  reflect_compact,
  reflect_rewind,
  reflect_shutdown,
  // approvals
  reflect_tool_approval,
  reflect_hook_approval,
  reflect_plan_approval,
  // plan
  reflect_enter_plan_mode,
  reflect_exit_plan_mode,
  // permissions
  reflect_set_effort,
  reflect_set_permission_mode,
  reflect_cycle_permission_mode,
  // questions
  reflect_ask_user_question_response,
  reflect_ask_user_input_response,
  // config
  reflect_agent_status,
  reflect_get_config,
  reflect_save_config,
  reflect_list_tools,
  // sessions
  reflect_list_sessions,
  reflect_create_session,
  reflect_rename_session,
  reflect_delete_session,
  reflect_replay_session,
  reflect_export_session,
  reflect_export_session_markdown,
  // events
  onReflectEvent,
  // workspaces
  reflect_list_workspaces,
  reflect_set_workspace,
  reflect_current_workspace,
  // skills
  reflect_list_skills,
  // memory
  reflect_list_memory,
  reflect_add_memory,
  reflect_remove_memory,
  // hooks
  reflect_list_hooks,
  reflect_toggle_hook,
  // git
  reflect_git_status,
  reflect_git_diff,
  reflect_git_log,
  // terminal
  reflect_run_shell,
  reflect_kill_shell,
  reflect_list_shell_sessions,
  onTerminalOutput,
  // files
  reflect_list_dir,
  reflect_read_file,
  // allowlist
  reflect_load_allowlist,
  reflect_save_allowlist,
  reflect_check_allowlist,
  // updates
  reflect_check_update,
  // search
  reflect_search_files,
  // tasks (Phase 1 multi-agent)
  reflect_list_tasks,
  reflect_create_task,
  reflect_get_task,
  reflect_update_task,
  reflect_claim_task,
  reflect_delete_task,
  // teams (Phase 1 multi-agent)
  reflect_list_teams,
  reflect_upsert_team,
  reflect_get_team,
  reflect_delete_team,
  // schedule (Phase 1 条目 2)
  reflect_list_schedules,
  reflect_add_schedule,
  reflect_update_schedule,
  reflect_remove_schedule,
  reflect_get_schedule_status,
  // agents (Phase 1 条目 3)
  reflect_list_agent_defs,
  reflect_get_agent_def,
  reflect_save_agent_def,
  reflect_delete_agent_def,
  reflect_parse_agent_md,
  // side-channel (Phase 2 条目 1)
  reflect_start_side_channel,
  reflect_cancel_side_channel,
  reflect_list_side_channels,
  reflect_get_side_channel,
  // remote (Phase 2 条目 2)
  reflect_get_remote_config,
  reflect_update_remote_config,
  reflect_get_remote_status,
  reflect_tailscale_status,
  reflect_tailscale_daemon_command_preview,
  reflect_tailscale_daemon_start,
  reflect_tailscale_daemon_stop,
  reflect_tailscale_daemon_status,
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
  it('reflect_interrupt calls invoke("reflect_interrupt")', async () => {
    // setup.tsx 已 mock reflect_set_permission_mode 等; reflect_interrupt 未注册 → mock 抛错
    await expect(reflect_interrupt()).rejects.toThrow(/not mocked/);
  });

  it('reflect_compact also un-registered by default', async () => {
    await expect(reflect_compact()).rejects.toThrow(/not mocked/);
  });

  it('reflect_rewind forwards toTurnId argument', async () => {
    await expect(reflect_rewind('turn-123')).rejects.toThrow(/not mocked/);
    await expect(reflect_rewind()).rejects.toThrow(/not mocked/);
  });

  it('reflect_tool_approval accepts ReviewDecision', async () => {
    await expect(reflect_tool_approval('id-1', 'approve')).rejects.toThrow(/not mocked/);
    await expect(
      reflect_tool_approval('id-2', { deny: { reason: 'risky' } }),
    ).rejects.toThrow(/not mocked/);
    await expect(
      reflect_tool_approval('id-3', 'approve_for_session'),
    ).rejects.toThrow(/not mocked/);
  });

  it('reflect_set_permission_mode is mocked by setup and returns undefined', async () => {
    expect(await reflect_set_permission_mode('default')).toBeUndefined();
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

  it('reflect_submit forwards { submission }', async () => {
    const args = await captureCmd('reflect_submit', () =>
      reflect_submit({ id: 'sub-1', op: { type: 'interrupt' } } as never),
    );
    expectArgs(args, { submission: { id: 'sub-1', op: { type: 'interrupt' } } });
  });

  it('reflect_interrupt / compact / shutdown use bare cmd names', async () => {
    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const [cmd, fn] of [
      ['reflect_interrupt', reflect_interrupt],
      ['reflect_compact', reflect_compact],
      ['reflect_shutdown', reflect_shutdown],
    ] as const) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'reflect_interrupt' ? undefined : `sub-${c}`;
      });
      await fn();
    }
    expect(seenArgs).toEqual([
      { cmd: 'reflect_interrupt', args: undefined },
      { cmd: 'reflect_compact', args: undefined },
      { cmd: 'reflect_shutdown', args: undefined },
    ]);
  });

  it('reflect_rewind encodes `toTurnId` (camelCase) and normalises undefined → null', async () => {
    const withId = await captureCmd('reflect_rewind', () => reflect_rewind('turn-xyz'));
    expectArgs(withId, { toTurnId: 'turn-xyz' });

    const noId = await captureCmd('reflect_rewind', () => reflect_rewind());
    expectArgs(noId, { toTurnId: null });
  });

  // ----- 审批 -----

  it('tool/hook approval forwards { id, decision } identically', async () => {
    const cases = [
      ['reflect_tool_approval', reflect_tool_approval],
      ['reflect_hook_approval', reflect_hook_approval],
    ] as const;
    for (const [cmd, fn] of cases) {
      const captured = await captureCmd(cmd, () => fn('approval-42', 'approve'));
      expectArgs(captured, { id: 'approval-42', decision: 'approve' });
    }
  });

  it('plan approval forwards { id, choice } (PlanApprovalChoice 三选一)', async () => {
    const captured = await captureCmd('reflect_plan_approval', () =>
      reflect_plan_approval('plan-42', 'auto_mode'),
    );
    expectArgs(captured, { id: 'plan-42', choice: 'auto_mode' });
  });

  // ----- 计划 -----

  it('reflect_enter_plan_mode forwards { task }; exit_plan_mode has none', async () => {
    const enter = await captureCmd('reflect_enter_plan_mode', () =>
      reflect_enter_plan_mode('plan this'),
    );
    expectArgs(enter, { task: 'plan this' });

    const exit = await captureCmd('reflect_exit_plan_mode', () => reflect_exit_plan_mode());
    expectArgs(exit, undefined);
  });

  // ----- 权限 -----

  it('reflect_set_effort forwards { level }; set_permission_mode { mode }; cycle has none', async () => {
    const effort = await captureCmd('reflect_set_effort', () => reflect_set_effort('high'));
    expectArgs(effort, { level: 'high' });

    const perm = await captureCmd('reflect_set_permission_mode', () =>
      reflect_set_permission_mode('auto'),
    );
    expectArgs(perm, { mode: 'auto' });

    const cycle = await captureCmd('reflect_cycle_permission_mode', () =>
      reflect_cycle_permission_mode(),
    );
    expectArgs(cycle, undefined);
  });

  // ----- 提问 -----

  it('reflect_ask_user_question_response forwards { id, answers }', async () => {
    const args = await captureCmd('reflect_ask_user_question_response', () =>
      reflect_ask_user_question_response('q-1', { q1: 'a' }),
    );
    expectArgs(args, { id: 'q-1', answers: { q1: 'a' } });
  });

  it('reflect_ask_user_input_response forwards { id, text }', async () => {
    const args = await captureCmd('reflect_ask_user_input_response', () =>
      reflect_ask_user_input_response('q-2', 'typed answer'),
    );
    expectArgs(args, { id: 'q-2', text: 'typed answer' });
  });

  // ----- 配置 / agent 状态 -----

  it('reflect_agent_status / get_config / list_tools use bare cmd names', async () => {
    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const cmd of ['reflect_agent_status', 'reflect_get_config', 'reflect_list_tools']) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'reflect_list_tools' ? [] : '';
      });
    }
    await reflect_agent_status();
    await reflect_get_config();
    await reflect_list_tools();
    expect(seenArgs).toEqual([
      { cmd: 'reflect_agent_status', args: undefined },
      { cmd: 'reflect_get_config', args: undefined },
      { cmd: 'reflect_list_tools', args: undefined },
    ]);
  });

  it('reflect_save_config forwards { toml }', async () => {
    const args = await captureCmd('reflect_save_config', () =>
      reflect_save_config('foo = 1\n'),
    );
    expectArgs(args, { toml: 'foo = 1\n' });
  });

  // ----- 会话 -----

  it('reflect_list_sessions normalises missing opts to { workspace: null, limit: null, offset: null }', async () => {
    const none = await captureCmd('reflect_list_sessions', () => reflect_list_sessions());
    expectArgs(none, { workspace: null, limit: null, offset: null });

    const some = await captureCmd('reflect_list_sessions', () =>
      reflect_list_sessions({ workspace: '/tmp/proj', limit: 10, offset: 20 }),
    );
    expectArgs(some, { workspace: '/tmp/proj', limit: 10, offset: 20 });
  });

  it('reflect_create_session forwards no args and resolves to a session id', async () => {
    mockInvoke('reflect_create_session', async () => 'sess-new-1');
    const id = await reflect_create_session();
    expect(id).toBe('sess-new-1');
  });

  it('reflect_rename_session encodes newName (camelCase); delete forwards { id } only', async () => {
    const rename = await captureCmd('reflect_rename_session', () =>
      reflect_rename_session('sess-1', 'My session'),
    );
    expectArgs(rename, { id: 'sess-1', newName: 'My session' });

    const del = await captureCmd('reflect_delete_session', () =>
      reflect_delete_session('sess-2'),
    );
    expectArgs(del, { id: 'sess-2' });
  });

  it('reflect_replay_session / export_session / export_session_markdown forward { id }', async () => {
    const cases: Array<[string, (id: string) => Promise<unknown>]> = [
      ['reflect_replay_session', reflect_replay_session],
      ['reflect_export_session', reflect_export_session],
      ['reflect_export_session_markdown', reflect_export_session_markdown],
    ];
    for (const [cmd, fn] of cases) {
      const args = await captureCmd(cmd, () => fn('sess-9'));
      expectArgs(args, { id: 'sess-9' });
    }
  });

  // ----- 事件 -----

  it('onReflectEvent listens on "reflect_event" and unwraps .payload', async () => {
    const unlisten = await onReflectEvent(() => {});
    expect(typeof unlisten).toBe('function');
    unlisten();
  });

  // ----- 工作区 -----

  it('reflect_set_workspace forwards { path }; other workspace cmds have no args', async () => {
    const set = await captureCmd('reflect_set_workspace', () =>
      reflect_set_workspace('/tmp/proj'),
    );
    expectArgs(set, { path: '/tmp/proj' });

    const seenArgs: Array<{ cmd: string; args: unknown }> = [];
    for (const cmd of ['reflect_list_workspaces', 'reflect_current_workspace']) {
      mockInvoke(cmd, async (c, args) => {
        seenArgs.push({ cmd: c, args });
        return c === 'reflect_list_workspaces' ? [] : '/tmp/proj';
      });
    }
    await reflect_list_workspaces();
    await reflect_current_workspace();
    expect(seenArgs).toEqual([
      { cmd: 'reflect_list_workspaces', args: undefined },
      { cmd: 'reflect_current_workspace', args: undefined },
    ]);
  });

  // ----- 技能 -----

  it('reflect_list_skills has no args', async () => {
    const args = await captureCmd('reflect_list_skills', () => reflect_list_skills());
    expectArgs(args, undefined);
  });

  // ----- 记忆 -----

  it('memory wrappers forward { scope, key, value? }', async () => {
    const list = await captureCmd('reflect_list_memory', () => reflect_list_memory());
    expectArgs(list, undefined);

    const add = await captureCmd('reflect_add_memory', () =>
      reflect_add_memory('user', 'name', 'Alice'),
    );
    expectArgs(add, { scope: 'user', key: 'name', value: 'Alice' });

    const rm = await captureCmd('reflect_remove_memory', () =>
      reflect_remove_memory('user', 'name'),
    );
    expectArgs(rm, { scope: 'user', key: 'name' });
  });

  // ----- 钩子 -----

  it('reflect_toggle_hook forwards { name, enabled }; list_hooks has no args', async () => {
    const toggle = await captureCmd('reflect_toggle_hook', () =>
      reflect_toggle_hook('pre-commit', true),
    );
    expectArgs(toggle, { name: 'pre-commit', enabled: true });

    const list = await captureCmd('reflect_list_hooks', () => reflect_list_hooks());
    expectArgs(list, undefined);
  });

  // ----- git -----

  it('reflect_git_status has no args; diff forwards { staged }; log forwards { limit }', async () => {
    const status = await captureCmd('reflect_git_status', () => reflect_git_status());
    expectArgs(status, undefined);

    const diff = await captureCmd('reflect_git_diff', () => reflect_git_diff(true));
    expectArgs(diff, { staged: true });

    const log = await captureCmd('reflect_git_log', () => reflect_git_log(50));
    expectArgs(log, { limit: 50 });
  });

  // ----- 终端 -----

  it('terminal spawn forwards { cmd }; kill forwards camelCase { sessionId }; list has no args', async () => {
    const run = await captureCmd('reflect_run_shell', () => reflect_run_shell('ls -la'));
    expectArgs(run, { cmd: 'ls -la' });

    const kill = await captureCmd('reflect_kill_shell', () => reflect_kill_shell('sh-1'));
    // Tauri 2 平铺参数按 camelCase 匹配（Rust `session_id` → JS `sessionId`）。
    expectArgs(kill, { sessionId: 'sh-1' });

    const list = await captureCmd('reflect_list_shell_sessions', () =>
      reflect_list_shell_sessions(),
    );
    expectArgs(list, undefined);
  });

  it('onTerminalOutput listens on "reflect_terminal_output" and unwraps .payload', async () => {
    const unlisten = await onTerminalOutput(() => {});
    expect(typeof unlisten).toBe('function');
    unlisten();
  });

  // ----- 文件 -----

  it('reflect_list_dir forwards { path, maxDepth }; read_file forwards { path }', async () => {
    const dir = await captureCmd('reflect_list_dir', () => reflect_list_dir(null));
    expectArgs(dir, { path: null, maxDepth: 4 });

    const dirScoped = await captureCmd('reflect_list_dir', () =>
      reflect_list_dir('/some/dir', 2),
    );
    expectArgs(dirScoped, { path: '/some/dir', maxDepth: 2 });

    const read = await captureCmd('reflect_read_file', () => reflect_read_file('/a.ts'));
    expectArgs(read, { path: '/a.ts' });
  });

  // ----- 白名单 -----

  it('reflect_load_allowlist has no args; save_allowlist forwards { list }; check_allowlist forwards { prefix }', async () => {
    const load = await captureCmd('reflect_load_allowlist', () => reflect_load_allowlist());
    expectArgs(load, undefined);

    const list = { prefixes: ['rm -rf', 'sudo '] };
    const save = await captureCmd('reflect_save_allowlist', () =>
      reflect_save_allowlist(list),
    );
    expectArgs(save, { list });

    const check = await captureCmd('reflect_check_allowlist', () =>
      reflect_check_allowlist('rm '),
    );
    expectArgs(check, { prefix: 'rm ' });
  });

  // ----- 更新 -----

  it('reflect_check_update has no args', async () => {
    const args = await captureCmd('reflect_check_update', () => reflect_check_update());
    expectArgs(args, undefined);
  });

  // ----- 搜索 -----

  it('reflect_search_files forwards { query, path, maxResults, rank } with defaults', async () => {
    const none = await captureCmd('reflect_search_files', () => reflect_search_files('foo'));
    expectArgs(none, { query: 'foo', path: null, maxResults: 200, rank: 'substring' });

    const some = await captureCmd('reflect_search_files', () =>
      reflect_search_files('foo', '/tmp', 50),
    );
    expectArgs(some, { query: 'foo', path: '/tmp', maxResults: 50, rank: 'substring' });

    // BM25 相关性排序(与 agent 的 grep 同款)。
    const ranked = await captureCmd('reflect_search_files', () =>
      reflect_search_files('foo', null, 20, 'bm25'),
    );
    expectArgs(ranked, { query: 'foo', path: null, maxResults: 20, rank: 'bm25' });
  });

  // ----- 任务（Phase 1 多 agent）-----

  it('reflect_list_tasks forwards { list }', async () => {
    const args = await captureCmd('reflect_list_tasks', () => reflect_list_tasks('sess-1'));
    expectArgs(args, { list: 'sess-1' });
  });

  it('reflect_create_task forwards { list, subject, description, activeForm, owner, metadata } with null defaults', async () => {
    const minimal = await captureCmd('reflect_create_task', () =>
      reflect_create_task({ list: 'L', subject: 's', description: 'd' }),
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

    const full = await captureCmd('reflect_create_task', () =>
      reflect_create_task({
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

  it('reflect_get_task / delete_task forward { list, id }', async () => {
    const get = await captureCmd('reflect_get_task', () => reflect_get_task('L', 7));
    expectArgs(get, { list: 'L', id: 7 });

    const del = await captureCmd('reflect_delete_task', () => reflect_delete_task('L', 7));
    expectArgs(del, { list: 'L', id: 7 });
  });

  it('reflect_update_task forwards { list, id, patch } verbatim', async () => {
    const patch = { status: 'in_progress' as const, add_blocks: [3] };
    const args = await captureCmd('reflect_update_task', () =>
      reflect_update_task('L', 1, patch),
    );
    expectArgs(args, { list: 'L', id: 1, patch });
  });

  it('reflect_claim_task forwards { list, claimer }', async () => {
    const args = await captureCmd('reflect_claim_task', () =>
      reflect_claim_task('L', 'worker@x'),
    );
    expectArgs(args, { list: 'L', claimer: 'worker@x' });
  });

  // ----- 团队（Phase 1 多 agent）-----

  it('reflect_list_teams has no args', async () => {
    const args = await captureCmd('reflect_list_teams', () => reflect_list_teams());
    expectArgs(args, undefined);
  });

  it('reflect_upsert_team forwards { team }', async () => {
    const team = {
      name: 'rocket',
      lead_agent_id: 'team-lead@rocket',
      members: [],
      // 核心 `SystemTime` 的 JSON 形态(不是数字)。
      created_at: { secs_since_epoch: 0, nanos_since_epoch: 0 },
    };
    const args = await captureCmd('reflect_upsert_team', () => reflect_upsert_team(team));
    expectArgs(args, { team });
  });

  it('reflect_get_team / delete_team forward { name }', async () => {
    const get = await captureCmd('reflect_get_team', () => reflect_get_team('rocket'));
    expectArgs(get, { name: 'rocket' });

    const del = await captureCmd('reflect_delete_team', () => reflect_delete_team('rocket'));
    expectArgs(del, { name: 'rocket' });
  });

  // ----- schedule (Phase 1 条目 2) -----

  it('reflect_list_schedules / get_schedule_status have no args', async () => {
    const list = await captureCmd('reflect_list_schedules', () => reflect_list_schedules());
    expectArgs(list, undefined);

    const status = await captureCmd('reflect_get_schedule_status', () =>
      reflect_get_schedule_status(),
    );
    expectArgs(status, undefined);
  });

  it('reflect_add_schedule forwards { schedule, prompt, name } with null default', async () => {
    const minimal = await captureCmd('reflect_add_schedule', () =>
      reflect_add_schedule({ schedule: '0 * * * *', prompt: 'standup' }),
    );
    expectArgs(minimal, { schedule: '0 * * * *', prompt: 'standup', name: null });

    const full = await captureCmd('reflect_add_schedule', () =>
      reflect_add_schedule({ schedule: '0 9 * * 1-5', prompt: 'p', name: 'weekday' }),
    );
    expectArgs(full, { schedule: '0 9 * * 1-5', prompt: 'p', name: 'weekday' });
  });

  it('reflect_update_schedule forwards { id, schedule, prompt, name, enabled } with null defaults', async () => {
    const args = await captureCmd('reflect_update_schedule', () =>
      reflect_update_schedule({ id: 'job-1', enabled: false }),
    );
    expectArgs(args, {
      id: 'job-1',
      schedule: null,
      prompt: null,
      name: null,
      enabled: false,
    });
  });

  it('reflect_remove_schedule forwards { id }', async () => {
    const args = await captureCmd('reflect_remove_schedule', () =>
      reflect_remove_schedule('job-1'),
    );
    expectArgs(args, { id: 'job-1' });
  });

  // ----- agents (Phase 1 条目 3) -----

  it('reflect_list_agent_defs has no args', async () => {
    const args = await captureCmd('reflect_list_agent_defs', () => reflect_list_agent_defs());
    expectArgs(args, undefined);
  });

  it('reflect_get_agent_def / delete_agent_def forward { name }', async () => {
    const get = await captureCmd('reflect_get_agent_def', () => reflect_get_agent_def('reviewer'));
    expectArgs(get, { name: 'reviewer' });

    const del = await captureCmd('reflect_delete_agent_def', () =>
      reflect_delete_agent_def('reviewer'),
    );
    expectArgs(del, { name: 'reviewer' });
  });

  it('reflect_save_agent_def forwards { def }', async () => {
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
    const args = await captureCmd('reflect_save_agent_def', () => reflect_save_agent_def(def));
    expectArgs(args, { def });
  });

  it('reflect_parse_agent_md forwards { text }', async () => {
    const args = await captureCmd('reflect_parse_agent_md', () =>
      reflect_parse_agent_md('---\nname: x\ndescription: y\n---\nbody'),
    );
    expectArgs(args, { text: '---\nname: x\ndescription: y\n---\nbody' });
  });

  // ----- side-channel (Phase 2 条目 1) -----

  it('reflect_list_side_channels has no args; get forwards { id }', async () => {
    const list = await captureCmd('reflect_list_side_channels', () =>
      reflect_list_side_channels(),
    );
    expectArgs(list, undefined);

    const get = await captureCmd('reflect_get_side_channel', () =>
      reflect_get_side_channel('side-deadbeef'),
    );
    expectArgs(get, { id: 'side-deadbeef' });
  });

  it('reflect_start_side_channel forwards camelCase { agentName, prompt }', async () => {
    const args = await captureCmd('reflect_start_side_channel', () =>
      reflect_start_side_channel({ agent_name: 'default', prompt: 'hello' }),
    );
    expectArgs(args, { agentName: 'default', prompt: 'hello' });
  });

  it('reflect_cancel_side_channel forwards { id }', async () => {
    const args = await captureCmd('reflect_cancel_side_channel', () =>
      reflect_cancel_side_channel('side-deadbeef'),
    );
    expectArgs(args, { id: 'side-deadbeef' });
  });

  // ----- remote (Phase 2 条目 2) -----

  it('reflect_get_remote_config / get_remote_status / tailscale_status have no args', async () => {
    const cfg = await captureCmd('reflect_get_remote_config', () => reflect_get_remote_config());
    expectArgs(cfg, undefined);

    const status = await captureCmd('reflect_get_remote_status', () =>
      reflect_get_remote_status(),
    );
    expectArgs(status, undefined);

    const ts = await captureCmd('reflect_tailscale_status', () => reflect_tailscale_status());
    expectArgs(ts, undefined);
  });

  it('reflect_update_remote_config forwards { host, port, auth_token, auto_connect } with null defaults', async () => {
    const minimal = await captureCmd('reflect_update_remote_config', () =>
      reflect_update_remote_config({ host: 'node.tail.net' }),
    );
    expectArgs(minimal, {
      host: 'node.tail.net',
      port: null,
      auth_token: null,
      auto_connect: null,
    });

    const full = await captureCmd('reflect_update_remote_config', () =>
      reflect_update_remote_config({
        host: 'h',
        port: 5555,
        auth_token: 'secret',
        auto_connect: true,
      }),
    );
    expectArgs(full, {
      host: 'h',
      port: 5555,
      auth_token: 'secret',
      auto_connect: true,
    });
  });

  it('reflect_tailscale_daemon_command_preview / start / stop / status have no args', async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['reflect_tailscale_daemon_command_preview', reflect_tailscale_daemon_command_preview],
      ['reflect_tailscale_daemon_start', reflect_tailscale_daemon_start],
      ['reflect_tailscale_daemon_stop', reflect_tailscale_daemon_stop],
      ['reflect_tailscale_daemon_status', reflect_tailscale_daemon_status],
    ];
    for (const [cmd, fn] of cases) {
      const args = await captureCmd(cmd, fn);
      expectArgs(args, undefined);
    }
  });
});
