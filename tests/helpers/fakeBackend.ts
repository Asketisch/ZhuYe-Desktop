/**
 * fakeBackend —— 烛夜（ZhuYe）全命令模拟后端（应用级测试专用）。
 *
 * 定位：不是"未 mock 就报错"的占位 mock，而是一个**有状态**的模拟后端：
 *   1. 实现 `src-tauri/src/commands/` 暴露的全部 `reflect_*` 命令 + `ping`，
 *      返回符合 reflect-protocol 线格式的确定性 fixture；
 *   2. 记录每次调用的 `(cmd, args)` 供测试断言真实 IPC 流量；
 *   3. 内置 ScriptedAgent —— `reflect_submit` 后按编排回放协议事件流，
 *      支持在审批/提问处"暂停等待用户决策"（gate），再继续执行，
 *      复刻真实 AgentThread 的请求-响应节奏。
 *
 * 事件注入走 `src/test/setup.tsx` 的 `emitMockEvent`，因此整条链路为：
 *   fakeBackend → mocked Tauri listen → agentEventBus → agentStore reducer → React 视图
 * 与生产环境的分发自完全一致。
 */
import { mockInvoke, resetMockInvoke, emitMockEvent } from '@/test/setup';
import type { ReflectEventMsg } from '@/types/protocol';

// ============================================================================
// 基础工具
// ============================================================================

const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/** 向 reflect_event 通道注入一条协议事件（走真实事件总线链路）。 */
export function emitEvent(id: string, msg: ReflectEventMsg): void {
  emitMockEvent('reflect_event', { id, msg });
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 线格式快照：真实 Tauri IPC 每次 invoke 都经 JSON 序列化生成全新对象树。
 * 返回活引用会让 React Query 的 structuralSharing 判定"数据未变"而跳过
 * 通知 —— 这里用 JSON round-trip 精确复刻线上的对象身份语义。
 */
const wire = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ============================================================================
// 类型
// ============================================================================

export interface FakeCall {
  cmd: string;
  args: Record<string, unknown> | undefined;
  at: number;
}

export interface FakeSession {
  session_id: string;
  model: string;
  started_at: string;
  message_count: number;
  title?: string;
  /** 创建时绑定的工作区（v1.x workspace→session 归属；旧会话可为 undefined）。 */
  workspace?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number | null;
}

/** 编排步骤：发射一组事件，或在指定交互处暂停等待用户响应。 */
export type ScriptStep =
  | { emit: ReflectEventMsg | ReflectEventMsg[] }
  | { gate: 'tool_approval' | 'hook_approval' | 'plan_approval' | 'question' | 'input'; id?: string };

export interface ToolApprovalRecord {
  id: string;
  decision: unknown;
}
export interface QuestionResponseRecord {
  id: string;
  answers: unknown;
}
export interface InputResponseRecord {
  id: string;
  text: string;
}
export interface PlanChoiceRecord {
  id: string;
  choice: unknown;
}
export interface CapturedSubmission {
  id: string;
  op: unknown;
}

// ============================================================================
// 后端状态
// ============================================================================

function defaultSessions(): FakeSession[] {
  return [
    {
      session_id: 'sess-alpha',
      model: 'anthropic/claude-sonnet-4',
      started_at: nowIso(-5 * 60_000), // 5 分钟前 → Now
      message_count: 4,
      title: 'Fix login bug',
      workspace: '/Users/dev/project',
      input_tokens: 1200,
      output_tokens: 800,
      total_tokens: 2000,
      cost_usd: 0.012,
    },
    {
      session_id: 'sess-beta',
      model: 'anthropic/claude-sonnet-4',
      started_at: nowIso(-3 * 3600_000), // 3 小时前 → Today
      message_count: 12,
      title: 'Refactor parser',
      workspace: '/Users/dev/project',
      total_tokens: 9000,
    },
    {
      session_id: 'sess-gamma',
      model: 'openai/gpt-5',
      started_at: nowIso(-30 * 3600_000), // 30 小时前 → Yesterday
      message_count: 7,
      title: 'Write docs',
      workspace: '/Users/dev/project',
      total_tokens: 4000,
    },
    {
      session_id: 'sess-delta',
      model: 'openai/gpt-5',
      started_at: nowIso(-4 * 86400_000), // 4 天前 → This week
      message_count: 2,
      workspace: '/Users/dev/project',
      total_tokens: 500,
    },
    {
      session_id: 'sess-omega',
      model: 'local/qwen3',
      started_at: nowIso(-21 * 86400_000), // 3 周前 → Earlier
      message_count: 1,
      title: 'Old experiment',
      workspace: '/Users/dev/project',
      total_tokens: 100,
    },
  ];
}

/** rollouts 按 session_id 索引，供 reflect_replay_session 水合。 */
function defaultRollouts(): Record<string, Array<Record<string, unknown>>> {
  return {
    'sess-alpha': [
      {
        type: 'message',
        turn_id: 'turn-alpha-1',
        role: 'user',
        content: 'Summarize the auth flow',
      },
      {
        type: 'message',
        turn_id: 'turn-alpha-1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'The auth flow uses JWT with refresh rotation.' },
          {
            type: 'tool_use',
            id: 'call-read-1',
            name: 'read_file',
            args: { path: 'src/auth.rs' },
          },
          {
            type: 'tool_result',
            call_id: 'call-read-1',
            output: {
              content: [{ type: 'text', text: 'pub fn verify_token(...) -> Result<Claims> {}' }],
              is_error: false,
            },
          },
        ],
      },
      { type: 'token_count', input_tokens: 1200, output_tokens: 800, total_tokens: 2000 },
    ],
  };
}

export interface FakeBackend {
  /** 全部 IPC 调用日志（最新在末尾）。 */
  calls: FakeCall[];
  /** 按命令名过滤调用日志。 */
  callsOf: (cmd: string) => FakeCall[];
  /** 最近一次指定命令的 args。 */
  lastArgsOf: (cmd: string) => Record<string, unknown> | undefined;

  // —— 可变状态（测试可直接改写后再触发 refetch）——
  state: {
    sessions: FakeSession[];
    /** 后端 AgentThread 当前绑定的 session id（reflect_bind_session 写入）。 */
    boundSessionId: string;
    /** 已归档会话（reflect_archive_session 移入，unarchive 移回）。 */
    archived: FakeSession[];
    rollouts: Record<string, Array<Record<string, unknown>>>;
    configToml: string;
    permissionMode: string;
    // 编辑器 Reject 恢复链路:reflect_write_file 的最后一次写入。
    lastWriteFile: { path: string; content: string } | null;
    /** 目标模式状态(Op::EnterGoalMode / ExitGoalMode)。 */
    goal: {
      active: boolean;
      goal: string | null;
      verifyCommand: string | null;
      tokenBudget: number | null;
      /** v1.7 快照口径:模拟的 goal turn 计数(reflect_goal_snapshot 返回)。 */
      turnCount: number;
      tokensUsed: number;
    };
    agentStatus: Record<string, unknown>;
    memory: Array<Record<string, unknown>>;
    hooks: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    tools: Array<Record<string, unknown>>;
    tasks: Array<Record<string, unknown>>;
    squads: Array<Record<string, unknown>>;
    teams: Array<Record<string, unknown>>;
    schedules: Array<Record<string, unknown>>;
    sideChannels: Array<Record<string, unknown>>;
    /** workspaces 线格式对齐后端 `WorkspaceInfo`（unix 秒）。 */
    workspaces: Array<{ path: string; label: string; last_used: number; session_count: number }>;
    /** `reflect_pick_workspace_folder` 的模拟返回值（null = 用户取消）。 */
    pickedFolder: string | null;
    /** `reflect_pick_file` 的模拟返回值（null = 用户取消）。 */
    pickedFile: string | null;
    activity: Array<Record<string, unknown>>;
    agentDefs: Array<Record<string, unknown>>;
    allowlist: { prefixes: string[] };
    /** 当前活跃 agent 名（`reflect_set_active_agent` / `reflect_get_active_agent`）。 */
    activeAgent: string;
    /** 推理强度（`reflect_set_effort` / `reflect_get_effort`）。 */
    effort: string;
    /** MCP 服务器条目（`reflect_upsert_mcp_server` / `reflect_list_mcp_servers` / `reflect_delete_mcp_server`）。 */
    mcpServers: Array<Record<string, unknown>>;
    /** 权限规则（`reflect_add_permission_rule` / `reflect_list_permission_rules`）。 */
    permissionRules: Array<Record<string, unknown>>;
    /** 子代理 spec（role → markdown）。 */
    subagentSpecs: Record<string, string>;
    /** 流水线配置（`reflect_save_pipeline_config` / `reflect_list_pipeline_configs`）。 */
    pipelineConfigs: Array<{ name: string; path: string; toml: string }>;
    /** KMS wiki 列表与页面（key = `${wiki}/${page}`）。 */
    wikis: Array<{ name: string; description: string }>;
    wikiPages: Record<string, { title: string | null; content: string; tags: string[] }>;
    /** Autopilot 配置 —— 线格式与 `app-core::autopilot::AutopilotConfig` 一致（camelCase）。 */
    autopilotConfig: Record<string, unknown>;
    /** 远程配置 —— 线格式与 `src-tauri/src/commands/remote.rs::RemoteConfigSnapshot` 一致（camelCase）。 */
    remoteConfig: { host: string; port: number; authToken: string | null; autoConnect: boolean; endpoint: string; isReady: boolean };
    /** `reflect_write_file` 写入的文件内容（path → content），供 `reflect_read_file` 读回。 */
    files: Record<string, string>;
    dirListing: Record<string, unknown>;
    gitStatus: Record<string, unknown>;
    gitDiff: string;
    gitLog: Array<Record<string, unknown>>;
    /** P3：stage/unstage/commit 语义捕获。 */
    gitStaged: string[];
    gitCommits: string[];
    /** P3：`gh pr list` 模拟返回（默认空）。 */
    pullRequests: Array<Record<string, unknown>>;
    /** P3：跨会话搜索的语料（session hit 形态）。 */
    rolloutsSearch: Array<{ session_id: string; title: string | null; snippet: string; started_at: string; message_count: number; match_count: number; text: string }>;
    shellSessions: string[];
    searchResult: Record<string, unknown> | null;
    /** 指定命令抛错（模拟后端故障）。 */
    failures: Record<string, Error>;
  };

  // —— 交互回执捕获 ——
  agent: {
    /** reflect_submit 捕获的 Submission 信封。 */
    submissions: CapturedSubmission[];
    toolApprovals: ToolApprovalRecord[];
    hookApprovals: ToolApprovalRecord[];
    planChoices: PlanChoiceRecord[];
    questionResponses: QuestionResponseRecord[];
    inputResponses: InputResponseRecord[];
    /** 当前编排（每次 installFakeBackend 重置）。 */
    script: ScriptStep[];
    /** 编排是否已全部执行完。 */
    finished: boolean;
  };

  /** 覆盖指定命令的返回（少量测试定制）。 */
  override: <T>(cmd: string, handler: (args?: Record<string, unknown>) => T | Promise<T>) => void;
  /** 已注册 handler 的命令清单（完整性校验用）。 */
  registeredCommands: string[];
}

// ============================================================================
// 安装
// ============================================================================

/**
 * 安装全命令模拟后端。清除 setup.tsx 的默认 handler，注册完整命令表。
 * 返回单例句柄（同一 module 实例内共享，便于跨 helper 访问）。
 */
export function installFakeBackend(): FakeBackend {
  resetMockInvoke();

  const backend: FakeBackend = {
    calls: [],
    callsOf: (cmd) => backend.calls.filter((c) => c.cmd === cmd),
    lastArgsOf: (cmd) => backend.callsOf(cmd).at(-1)?.args,
    state: {
      sessions: defaultSessions(),
      boundSessionId: '',
      archived: [
        {
          session_id: 'sess-archived',
          model: 'local/qwen3',
          started_at: nowIso(-40 * 86400_000),
          message_count: 3,
          title: 'Old backlog',
          workspace: '/Users/dev/project',
          total_tokens: 300,
        },
      ],
      rollouts: defaultRollouts(),
      configToml: '[active]\nprovider = "anthropic"\nmodel = "claude-sonnet-4"\n',
      lastWriteFile: null,
      permissionMode: 'prompt',
      goal: { active: false, goal: null, verifyCommand: null, tokenBudget: null, turnCount: 0, tokensUsed: 0 },
      agentStatus: {
        ready: true,
        has_model: true,
        model: 'anthropic/claude-sonnet-4',
        workspace: '/Users/dev/project',
        degraded_reason: null,
      },
      memory: [
        { scope: 'project', key: 'build-cmd', value: 'pnpm build', at: nowIso(-3600_000) },
        { scope: 'user', key: 'style', value: 'concise', at: nowIso(-7200_000) },
      ],
      hooks: [
        { name: 'fmt-on-save', kind: 'custom', enabled: true, config_summary: 'rustfmt' },
        { name: 'audit-deps', kind: 'custom', enabled: false, config_summary: 'cargo audit' },
      ],
      skills: [
        { name: 'release', description: 'Cut a release', source: 'builtin' },
        { name: 'triage', description: 'Triage issues', source: 'project' },
      ],
      tools: [
        { name: 'read_file', description: 'Read a file', server: null },
        { name: 'web_search', description: 'Search the web', server: 'mcp-search' },
      ],
      tasks: [
        {
          id: 1,
          list: 'default',
          subject: 'Ship v2',
          description: 'Finalize the v2 release',
          status: 'in_progress',
          owner: 'agent-7',
          updated_at: nowIso(-600_000),
        },
        {
          id: 2,
          list: 'default',
          subject: 'Write changelog',
          description: 'Changelog for v2',
          status: 'pending',
          owner: null,
          updated_at: nowIso(-1200_000),
        },
      ],
      squads: [
        {
          name: 'rocket',
          description: 'go fast',
          leaderActor: { actorType: 'agent', actorId: 'team-lead@rocket' },
          members: [{ actorType: 'agent', actorId: 'dev-1@rocket' }],
        },
      ],
      teams: [{ name: 'core', members: ['agent-7', 'agent-9'] }],
      schedules: [
        {
          id: 'cron-1',
          name: 'nightly-build',
          schedule: '0 3 * * *',
          prompt: 'run the nightly build',
          enabled: true,
          created_at: nowIso(-86400_000 * 7),
          last_fired: null,
        },
      ],
      sideChannels: [
        {
          id: 'sc-1',
          prompt: 'background research',
          status: 'running',
          started_at: nowIso(-60_000),
        },
      ],
      workspaces: [
        { path: '/Users/dev/project', label: 'project', last_used: Math.floor(Date.now() / 1000) - 86_400, session_count: 2 },
        { path: '/Users/dev/scratch', label: 'scratch', last_used: Math.floor(Date.now() / 1000) - 172_800, session_count: 0 },
      ],
      pickedFolder: null,
      pickedFile: null,
      activity: [
        { kind: 'tool_call', label: 'read_file(src/lib.rs)', at: nowIso(-300_000) },
        { kind: 'message', label: 'user: hello', at: nowIso(-400_000) },
      ],
      agentDefs: [
        { name: 'reviewer', description: 'Code reviewer', model: 'claude-sonnet-4', tools: [] },
      ],
      allowlist: { prefixes: ['ls', 'read_file'] },
      activeAgent: 'default',
      effort: 'low',
      mcpServers: [
        {
          name: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          url: null,
          running: true,
        },
      ],
      permissionRules: [
        { tool: 'Bash', action: 'deny', toolGlob: null, shellPattern: 'rm -rf *', scope: 'config' },
        { tool: 'Read', action: 'allow', toolGlob: null, shellPattern: null, scope: 'user' },
      ],
      subagentSpecs: { explorer: '---\nname: explorer\nrole: explorer\n---\n' },
      pipelineConfigs: [
        { name: 'my-pipeline', path: '/tmp/home/.zhuye/pipelines/my-pipeline.toml', toml: 'name = "my-pipeline"\n' },
      ],
      wikis: [{ name: 'engineering', description: 'Eng wiki' }],
      wikiPages: { 'engineering/auth': { title: 'Auth', content: '---\ntitle: Auth\n---\n# Auth\nJWT flow', tags: [] } },
      autopilotConfig: { enabled: false, schedule: '0 9 * * *', taskTemplate: '', agent: null, maxConcurrent: 1 },
      remoteConfig: { host: '', port: 4732, authToken: null, autoConnect: false, endpoint: '', isReady: false },
      files: {},
      dirListing: {
        path: '/Users/dev/project',
        entries: [
          { path: '/Users/dev/project/src', name: 'src', kind: 'dir' },
          { path: '/Users/dev/project/README.md', name: 'README.md', kind: 'file', size: 1024 },
          { path: '/Users/dev/project/Cargo.toml', name: 'Cargo.toml', kind: 'file', size: 512 },
        ],
      },
      gitStatus: {
        branch: 'main',
        upstream: 'origin/main',
        ahead: 2,
        behind: 0,
        entries: [
          { path: 'src/lib.rs', status: 'M', staged: true, old_path: null },
          { path: 'docs/new.md', status: 'A', staged: true, old_path: null },
        ],
        raw: 'M  src/lib.rs\nA  docs/new.md\n',
        is_repo: true,
      },
      gitDiff: 'diff --git a/src/lib.rs b/src/lib.rs\n+pub fn new_fn() {}\n',
      gitLog: [
        { hash: 'abc1234567', short_hash: 'abc1234', author: 'dev', timestamp: Math.floor(Date.now() / 1000) - 86_400, subject: 'feat: parser' },
        { hash: 'def5678901', short_hash: 'def5678', author: 'dev', timestamp: Math.floor(Date.now() / 1000) - 172_800, subject: 'chore: deps' },
      ],
      shellSessions: ['shell-a', 'shell-b'],
      gitStaged: [],
      gitCommits: [],
      pullRequests: [],
      rolloutsSearch: [],
      searchResult: {
        query: 'verify_token',
        matches: [
          { path: 'src/auth.rs', line: 42, preview: 'pub fn verify_token(tok: &str) -> Result<Claims> {' },
        ],
      },
      failures: {},
    },
    agent: {
      submissions: [],
      toolApprovals: [],
      hookApprovals: [],
      planChoices: [],
      questionResponses: [],
      inputResponses: [],
      script: [],
      finished: false,
    },
    override: (cmd, handler) => {
      mockInvoke(cmd, async (_c: string, args?: Record<string, unknown>) => {
        backend.calls.push({ cmd, args, at: Date.now() });
        return handler(args);
      });
    },
    registeredCommands: [],
  };

  const handler =
    <T>(fn: (args?: Record<string, unknown>) => T | Promise<T>) =>
    async (_cmd: string, args?: Record<string, unknown>) => {
      backend.calls.push({ cmd: _cmd, args, at: Date.now() });
      const failure = backend.state.failures[_cmd];
      if (failure) throw failure;
      return fn(args);
    };

  /**
   * 注册命令 handler 并登记到 registeredCommands。
   * 调用点传入 `handler(fn)`（已含调用日志/故障注入的闭包），此处仅登记。
   */
  function handle(cmd: string, h: (...a: unknown[]) => unknown): void {
    backend.registeredCommands.push(cmd);
    mockInvoke(cmd, h as never);
  }

  // ========================== ScriptedAgent ==========================
  // reflect_submit 后按 script 顺序执行；gate 步骤挂起等待对应的
  // 审批/问答响应命令到达后继续 —— 复刻真实 agent 的暂停-恢复节奏。

  let runToken = 0;

  async function runScript(submissionId: string): Promise<void> {
    const token = ++runToken;
    // 对齐真实 AgentThread 的 turn 生命周期:submission 受理即
    // turn_started,编排跑完(无 gate 挂起)即 turn_complete ——
    // 前端的运行中判定(运行中发送 → 入队)依赖这对事件收尾。
    emitEvent(submissionId, { type: 'turn_started', turn_id: submissionId });
    let i = 0;
    while (i < backend.agent.script.length) {
      if (token !== runToken) return; // 新 submission 到达，旧编排作废
      const step = backend.agent.script[i];
      if ('emit' in step) {
        const msgs = Array.isArray(step.emit) ? step.emit : [step.emit];
        for (const msg of msgs) emitEvent(submissionId, msg);
        await tick();
        i += 1;
      } else {
        // gate：等待匹配的响应命令出现。
        const gate = step;
        const matched = await waitForGate(gate, token);
        if (!matched) return; // 被新 submission 抢占
        await tick();
        i += 1;
      }
    }
    emitEvent(submissionId, {
      type: 'turn_complete',
      turn_id: submissionId,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 0,
      },
      status: 'success',
    });
    backend.agent.finished = true;
  }

  function waitForGate(gate: Extract<ScriptStep, { gate: unknown }>, token: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const poll = () => {
        if (token !== runToken) return resolve(false);
        const hit = gateRecordFor(gate);
        if (hit) resolve(true);
        else setTimeout(poll, 5);
      };
      poll();
    });
  }

  function gateRecordFor(gate: Extract<ScriptStep, { gate: unknown }>): unknown {
    const list =
      gate.gate === 'tool_approval'
        ? backend.agent.toolApprovals
        : gate.gate === 'hook_approval'
          ? backend.agent.hookApprovals
          : gate.gate === 'plan_approval'
            ? backend.agent.planChoices
            : gate.gate === 'question'
              ? backend.agent.questionResponses
              : backend.agent.inputResponses;
    if (!gate.id) return list.length > 0 ? list[list.length - 1] : null;
    return list.find((r) => 'id' in r && (r as { id: string }).id === gate.id) ?? null;
  }

  // ========================== 命令表 ==========================

  // —— agent 生命周期 / 对话 ——
  handle('ping', handler(() => ({ msg: 'pong', version: 'test-0.1.0' })));

  // Dock 徽标 —— 同步命令(`pub fn`),前端 `src/utils/notify.ts` 在待办数
  // 变化时会调。此前替身里**没有**这条:后端命令名提取只扫 `pub async fn`,
  // 同步命令整个漏掉,契约测试因此没能发现。
  handle('reflect_set_dock_badge', handler(() => undefined));

  handle(
    'reflect_submit',
    handler((args) => {
      const submission = args?.submission as { id: string; op: unknown } | undefined;
      if (submission) {
        backend.agent.submissions.push({ id: submission.id, op: submission.op });
        void runScript(submission.id);
      }
      return submission?.id ?? '';
    }),
  );

  // 中断只影响在飞回合,会话不受影响;返回 submission id。
  handle('reflect_interrupt', handler(() => 'interrupted'));
  handle('reflect_compact', handler(() => 'compacted'));
  handle('reflect_rewind', handler(() => 'rewound'));
  handle('reflect_shutdown', handler(() => 'shutdown-complete'));

  // —— v1.4 转向 / 子代理可观测 ——
  // steer:引擎注入不发协议事件;GUI 依赖乐观渲染,这里仅回执 submission id。
  handle('reflect_steer', handler(() => 'steered'));
  handle('reflect_query_subagents', handler(() => 'queried-subagents'));

  // —— 审批 / 问答回执 ——
  handle(
    'reflect_tool_approval',
    handler((args) => {
      backend.agent.toolApprovals.push({
        id: String(args?.id),
        decision: args?.decision,
      });
      return 'ok';
    }),
  );
  handle(
    'reflect_hook_approval',
    handler((args) => {
      backend.agent.hookApprovals.push({ id: String(args?.id), decision: args?.decision });
      return 'ok';
    }),
  );
  handle(
    'reflect_plan_approval',
    handler((args) => {
      backend.agent.planChoices.push({ id: String(args?.id), choice: args?.choice });
      return 'ok';
    }),
  );
  handle(
    'reflect_ask_user_question_response',
    handler((args) => {
      backend.agent.questionResponses.push({ id: String(args?.id), answers: args?.answers });
      return 'ok';
    }),
  );
  handle(
    'reflect_ask_user_input_response',
    handler((args) => {
      backend.agent.inputResponses.push({ id: String(args?.id), text: String(args?.text ?? '') });
      return 'ok';
    }),
  );

  // —— plan / goal / effort / 权限 ——
  handle('reflect_enter_plan_mode', handler(() => 'plan-mode'));
  handle('reflect_exit_plan_mode', handler(() => 'prompt'));
  handle(
    'reflect_enter_goal_mode',
    handler((args) => {
      backend.state.goal = {
        active: true,
        goal: String(args?.goal ?? ''),
        verifyCommand: args?.verifyCommand == null ? null : String(args.verifyCommand),
        tokenBudget: args?.tokenBudget == null ? null : Number(args.tokenBudget),
        turnCount: 0,
        tokensUsed: 0,
      };
      return 'goal-mode';
    }),
  );
  handle('reflect_exit_goal_mode', handler(() => {
    backend.state.goal = { active: false, goal: null, verifyCommand: null, tokenBudget: null, turnCount: 0, tokensUsed: 0 };
    return 'goal-exited';
  }));
  // v1.7:目标模式状态快照 —— 活跃时回 GoalSnapshotPayload 形态(镜像
  // Rust GoalState,snake_case),未活跃返回 null,与真后端语义一致。
  handle('reflect_goal_snapshot', handler(() => {
    const g = backend.state.goal;
    if (!g.active || g.goal == null) return null;
    return {
      goal: g.goal,
      verify_command: g.verifyCommand,
      token_budget: g.tokenBudget,
      status: 'active',
      tokens_used: g.tokensUsed,
      turn_count: g.turnCount,
      consecutive_blocked_turns: 0,
      started_at: new Date().toISOString(),
      turns: [],
    };
  }));
  handle(
    'reflect_set_effort',
    handler((args) => {
      backend.state.effort = String(args?.level ?? backend.state.effort);
      return backend.state.effort;
    }),
  );
  handle(
    'reflect_set_permission_mode',
    handler((args) => {
      backend.state.permissionMode = String(args?.mode);
      return backend.state.permissionMode;
    }),
  );
  handle(
    'reflect_cycle_permission_mode',
    handler(() => {
      const order = ['auto', 'prompt', 'deny', 'plan'];
      const idx = order.indexOf(backend.state.permissionMode);
      backend.state.permissionMode = order[(idx + 1) % order.length];
      return backend.state.permissionMode;
    }),
  );

  // —— 会话 ——
  // workspace 过滤语义与后端一致：`Some(ws)` 精确匹配 SessionMeta.workspace；
  // `None`/空串 返回全量（旧会话 workspace=undefined 仅在无过滤时出现）。
  const workspaceFilter =
    (rows: FakeSession[]) =>
    (args?: Record<string, unknown>): FakeSession[] => {
      const ws =
        typeof args?.workspace === 'string' && args.workspace.length > 0
          ? args.workspace
          : null;
      return ws ? rows.filter((s) => s.workspace === ws) : rows;
    };
  // reflect_create_session：纯 ID 分配（真实 session 在首条 submission 时物化）。
  let sessionSeq = 0;
  handle(
    'reflect_create_session',
    handler(() => {
      sessionSeq += 1;
      return `sess-new-${sessionSeq}`;
    }),
  );
  // reflect_bind_session：把后端 AgentThread 绑到指定 session id。
  // 后端幂等(同 id 短路);fakeBackend 记录最近绑定的 id 供断言。
  // 返回值 = 绑定后线程的 PermissionMode(线格式字符串,真实后端从会话
  // 审计轨迹恢复);ChatView 用它同步本地徽标,不能返回 undefined。
  handle(
    'reflect_bind_session',
    handler((args) => {
      backend.state.boundSessionId = String(args?.id ?? '');
      return backend.state.permissionMode;
    }),
  );
  handle(
    'reflect_list_sessions',
    handler((args) => wire(workspaceFilter(backend.state.sessions)(args))),
  );
  handle(
    'reflect_rename_session',
    handler((args) => {
      const s = backend.state.sessions.find((x) => x.session_id === args?.id);
      if (s) s.title = String(args?.newName);
    }),
  );
  handle(
    'reflect_generate_session_title',
    handler((args) => {
      const s = backend.state.sessions.find((x) => x.session_id === args?.id);
      if (s && !s.title) s.title = 'AI 生成的标题';
      return s?.title ?? 'AI 生成的标题';
    }),
  );
  handle(
    'reflect_delete_session',
    handler((args) => {
      backend.state.sessions = backend.state.sessions.filter((x) => x.session_id !== args?.id);
      backend.state.archived = backend.state.archived.filter((x) => x.session_id !== args?.id);
    }),
  );
  handle(
    'reflect_archive_session',
    handler((args) => {
      const idx = backend.state.sessions.findIndex((x) => x.session_id === args?.id);
      if (idx >= 0) {
        const [moved] = backend.state.sessions.splice(idx, 1);
        backend.state.archived.unshift(moved);
      }
    }),
  );
  handle(
    'reflect_unarchive_session',
    handler((args) => {
      const idx = backend.state.archived.findIndex((x) => x.session_id === args?.id);
      if (idx >= 0) {
        const [moved] = backend.state.archived.splice(idx, 1);
        backend.state.sessions.unshift(moved);
      }
    }),
  );
  handle(
    'reflect_list_archived_sessions',
    handler((args) => wire(workspaceFilter(backend.state.archived)(args))),
  );
  handle(
    'reflect_replay_session',
    handler((args) => wire(backend.state.rollouts[String(args?.id)] ?? [])),
  );
  handle(
    'reflect_export_session',
    handler(() => '/tmp/export.reflect'),
  );
  handle(
    'reflect_export_session_markdown',
    handler(() => ({ path: '/tmp/export.md', bytes: 128 })),
  );

  // —— 配置 / 健康 ——
  handle('reflect_get_config', handler(() => backend.state.configToml));
  handle(
    'reflect_save_config',
    handler((args) => {
      backend.state.configToml = String(args?.toml ?? '');
    }),
  );
  // 模型热切换：镜像后端「改 active/provider 段 → resolved spec 变化」，
  // 这里仅同步 agentStatus.model（真实 TOML 手术在后端）。
  handle(
    'reflect_set_model',
    handler((args) => {
      const spec = `${String(args?.provider)}/${String(args?.model ?? '')}`;
      backend.state.agentStatus = {
        ...backend.state.agentStatus,
        model: spec,
        has_model: true,
        ready: true,
        degraded_reason: null,
      };
      return spec;
    }),
  );
  handle('reflect_get_effort', handler(() => backend.state.effort));
  // plan 余量查询：默认返回一个成功快照（真实厂商 HTTP 查询在后端）。
  handle(
    'reflect_query_plan_quota',
    handler(() => ({
      success: true,
      error: null,
      utilization: 42.0,
      remaining_tokens: 80000,
      max_tokens: 120000,
      resets_at: '2026-08-28T18:00:00Z',
    })),
  );
  // provider 模型列表：默认返回两条（一条带 vision 能力标记，一条无）。
  handle(
    'reflect_list_provider_models',
    handler(() => ({
      endpoint: String('openai'),
      models: [
        {
          id: 'gpt-4o',
          display_name: 'gpt-4o',
          supports_vision: true,
          is_free: false,
          context_window: 128000,
        },
        {
          id: 'gpt-4o-mini',
          display_name: 'gpt-4o-mini',
          supports_vision: null,
          is_free: null,
          context_window: null,
        },
      ],
    })),
  );
  // LSP：默认关闭；开关只翻转状态，warmup 报告未预热。
  let lspEnabled = false;
  handle('reflect_lsp_set_enabled', handler((args) => {
    lspEnabled = Boolean(args?.enabled);
    return { enabled: lspEnabled, servers: lspEnabled ? ['rust-analyzer'] : [] };
  }));
  handle('reflect_lsp_status', handler(() => ({
    enabled: lspEnabled,
    servers: [],
    diagnostics: { documents: 0, count: 0, statusLine: '' },
  })));
  handle('reflect_lsp_warmup', handler(() => ({ warmed: lspEnabled, server: null })));
  handle('reflect_lsp_diagnostics', handler(() => [
    {
      line: 12,
      column: 5,
      endLine: 12,
      endColumn: 9,
      severity: 'warning',
      message: 'unused variable: `foo`',
      source: 'rustc',
      code: 'unused_variables',
    },
  ]));
  // 「你好」测试消息：返回固定回复（真实厂商 HTTP 调用在后端）。
  handle(
    'reflect_test_provider_chat',
    handler(() => ({ reply: '你好！有什么可以帮你？' })),
  );
  handle(
    'reflect_git_stage',
    handler((args) => {
      backend.state.gitStaged.push(...((args?.paths as string[]) ?? []));
    }),
  );
  handle(
    'reflect_git_unstage',
    handler((args) => {
      const paths = (args?.paths as string[]) ?? [];
      backend.state.gitStaged = backend.state.gitStaged.filter((p) => !paths.includes(p));
    }),
  );
  handle(
    'reflect_git_commit',
    handler((args) => {
      backend.state.gitCommits.push(String(args?.message ?? ''));
      return `a${backend.state.gitCommits.length}bcdef`;
    }),
  );
  handle('reflect_gh_pr_list', handler(() => backend.state.pullRequests));
  // 写回文件：记录最后写入（供编辑器 Reject 恢复链路测试），并存入 files
  // 让 `reflect_read_file` 能按路径读回 —— 与真后端的写→读语义一致。
  handle(
    'reflect_write_file',
    handler((args) => {
      const path = String(args?.path ?? '');
      const content = String(args?.content ?? '');
      backend.state.lastWriteFile = { path, content };
      backend.state.files[path] = content;
      return path;
    }),
  );
  handle(
    'reflect_search_sessions',
    handler((args) => {
      const q = String(args?.query ?? '').toLowerCase();
      if (!q) return [];
      return backend.state.rolloutsSearch
        .filter((r) => r.text.toLowerCase().includes(q))
        .slice(0, Number(args?.limit ?? 20));
    }),
  );
  handle('reflect_agent_status', handler(() => wire(backend.state.agentStatus)));
  handle('reflect_list_tools', handler(() => wire(backend.state.tools)));

  // —— 文件 / 搜索 ——
  handle('reflect_list_dir', handler(() => wire(backend.state.dirListing)));
  // 线格式与真后端 `reflect_read_file` 一致：{ path, content, size, binary, truncated }。
  // 由 `reflect_write_file` 写过的路径按内容读回；其它路径返回固定 fixture。
  handle(
    'reflect_read_file',
    handler((args) => {
      const path = String(args?.path ?? 'x');
      const content = backend.state.files[path] ?? 'fn main() {}';
      return { path, content, size: content.length, binary: false, truncated: false };
    }),
  );
  handle('reflect_read_image_base64', handler(() => ({ path: 'x', mime_type: 'image/png', base64: 'AAAA', size: 3 })));
  handle('reflect_fork_session', handler(() => 'f0f0f0f0-0000-4000-8000-000000000001'));
  handle('reflect_search_files', handler(() => wire(backend.state.searchResult)));

  // —— git ——
  handle('reflect_git_status', handler(() => wire(backend.state.gitStatus)));
  handle('reflect_git_diff', handler(() => backend.state.gitDiff));
  handle('reflect_git_log', handler(() => wire(backend.state.gitLog)));

  // —— 终端 ——
  handle(
    'reflect_run_shell',
    handler((args) => {
      const sid = `shell-${backend.state.shellSessions.length + 1}`;
      backend.state.shellSessions.push(sid);
      return { session_id: sid, cmd: String(args?.cmd ?? ''), status: 'running' };
    }),
  );
  handle(
    'reflect_kill_shell',
    handler((args) => {
      // 前端经 Tauri 2 camelCase 匹配,Rust 参数 `session_id` 收到的键是 sessionId。
      backend.state.shellSessions = backend.state.shellSessions.filter((s) => s !== args?.sessionId);
    }),
  );
  handle('reflect_list_shell_sessions', handler(() => wire(backend.state.shellSessions)));

  // —— 记忆 ——
  const checkMemoryContext = (args: Record<string, any> | undefined) => {
    const expected = args?.expectedContext;
    if (expected && (expected.workspace !== (backend.state.workspaces[0]?.path ?? '/Users/dev/project') || expected.agent !== backend.state.activeAgent)) {
      throw new Error('memory workspace or active agent changed; reload and retry');
    }
  };
  handle('reflect_list_memory', handler((args) => { checkMemoryContext(args); return wire(backend.state.memory); }));
  handle(
    'reflect_add_memory',
    handler((args) => {
      checkMemoryContext(args);
      const existing = backend.state.memory.find((m) => m.scope === args?.scope && m.key === args?.key);
      if (args?.expectedValue !== undefined && (!existing || existing.value !== args.expectedValue || Boolean(existing.wholeDocument) !== Boolean(args?.replaceDocument))) throw new Error('memory entry changed or was removed; reload before retrying');
      if (args?.replaceDocument && !existing?.wholeDocument) throw new Error('memory document changed; reload before replacing it');
      if (args?.createOnly && existing) throw new Error(`memory entry already exists: ${String(args?.key)}`);
      if (existing) {
        existing.value = args?.value;
        return;
      }
      backend.state.memory.push({
        scope: args?.scope,
        key: args?.key,
        value: args?.value,
        at: nowIso(),
      });
    }),
  );
  handle(
    'reflect_remove_memory',
    handler((args) => {
      checkMemoryContext(args);
      const existing = backend.state.memory.find((m) => m.scope === args?.scope && m.key === args?.key);
      if (args?.expectedValue !== undefined && (!existing || existing.value !== args.expectedValue || Boolean(existing.wholeDocument) !== Boolean(args?.replaceDocument))) throw new Error('memory entry changed or was removed; reload before retrying');
      if (args?.replaceDocument && !existing?.wholeDocument) throw new Error('memory document changed; reload before replacing it');
      backend.state.memory = backend.state.memory.filter(
        (m) => !(m.scope === args?.scope && m.key === args?.key),
      );
    }),
  );

  // —— 技能 / 钩子 ——
  handle('reflect_list_skills', handler(() => wire(backend.state.skills)));
  // 扩展重扫(上游 v1.x Op::RescanExtensions 的桥接):fake 无运行时,
  // 回 submission 形状的占位 id;真实条目数走 extensions_rescanned 事件。
  handle(
    'reflect_rescan_extensions',
    handler(() => `rescan-fake-${Date.now()}`),
  );
  handle('reflect_list_hooks', handler(() => wire(backend.state.hooks)));
  // 插件 slash 命令列表(fakeBackend 无插件运行时,恒空列表)。
  handle('reflect_list_plugin_commands', handler(() => wire([])));
  handle(
    'reflect_toggle_hook',
    handler((args) => {
      const h = backend.state.hooks.find((x) => x.name === args?.name);
      if (!h) throw new Error(`hook is not registered: ${String(args?.name)}`);
      h.enabled = Boolean(args?.enabled);
    }),
  );

  // —— tasks ——
  handle('reflect_list_tasks', handler(() => wire(backend.state.tasks)));
  handle(
    'reflect_create_task',
    handler((args) => {
      const task = { id: `task-${backend.state.tasks.length + 1}`, status: 'pending', ...args };
      backend.state.tasks.push(task);
      return task;
    }),
  );
  handle('reflect_get_task', handler(() => wire(backend.state.tasks[0] ?? null)));
  handle(
    'reflect_update_task',
    handler((args) => {
      const t = backend.state.tasks.find(
        (x) => x.id === args?.id && (x.list ?? 'default') === (args?.list ?? 'default'),
      );
      if (t) Object.assign(t, args?.patch ?? {});
      return { updated: true };
    }),
  );
  handle('reflect_claim_task', handler(() => wire(backend.state.tasks.find((t) => t.status === 'pending') ?? null)));
  handle('reflect_get_task_output', handler(() => 'worker output: done in 3s\n'));
  handle('reflect_stop_task', handler(() => ({ task: null, updatedFields: ['status'] })));
  handle('reflect_release_task', handler(() => ({ task: null, updatedFields: ['status'] })));
  handle(
    'reflect_delete_task',
    handler((args) => {
      backend.state.tasks = backend.state.tasks.filter((t) => !(t.id === args?.id && t.list === args?.list));
    }),
  );

  // —— squad / teams ——
  handle('reflect_list_squads', handler(() => wire(backend.state.squads)));
  handle(
    'reflect_create_squad',
    handler((args) => {
      const spec = (args?.spec ?? {}) as Record<string, unknown>;
      const squad = { members: [], ...spec };
      backend.state.squads.push(squad);
      return squad;
    }),
  );
  handle(
    'reflect_get_squad',
    handler((args) => backend.state.squads.find((s) => s.name === args?.name) ?? null),
  );
  handle(
    'reflect_delete_squad',
    handler((args) => {
      backend.state.squads = backend.state.squads.filter((s) => s.name !== args?.name);
    }),
  );
  handle('reflect_delegate_next', handler(() => 'delegated'));
  handle('reflect_assign_squad_task', handler(() => 'assigned'));

  handle('reflect_list_teams', handler(() => wire(backend.state.teams)));
  handle('reflect_upsert_team', handler((args) => {
    const team = args?.team as Record<string, unknown> | undefined;
    if (team) backend.state.teams.push(team);
  }));
  handle(
    'reflect_get_team',
    handler((args) => backend.state.teams.find((t) => t.name === args?.name) ?? null),
  );
  handle(
    'reflect_delete_team',
    handler((args) => {
      backend.state.teams = backend.state.teams.filter((t) => t.name !== args?.name);
    }),
  );

  // —— schedule ——
  handle('reflect_list_schedules', handler(() => wire(backend.state.schedules)));
  handle(
    'reflect_add_schedule',
    handler((args) => {
      const job = { id: `cron-${backend.state.schedules.length + 1}`, enabled: true, ...args };
      backend.state.schedules.push(job);
      return job;
    }),
  );
  handle(
    'reflect_update_schedule',
    handler((args) => {
      const j = backend.state.schedules.find((x) => x.id === args?.id);
      if (j) Object.assign(j, args?.patch ?? args ?? {});
      return j ?? null;
    }),
  );
  handle(
    'reflect_remove_schedule',
    handler((args) => {
      backend.state.schedules = backend.state.schedules.filter((s) => s.id !== args?.id);
      return true;
    }),
  );
  handle('reflect_get_schedule_status', handler(() => ({
    status: 'has_jobs',
    line: '1 of 1 jobs enabled',
    total: 1,
    enabled: 1,
  })));

  // —— side channel ——
  handle('reflect_list_side_channels', handler(() => wire(backend.state.sideChannels)));
  handle(
    'reflect_start_side_channel',
    handler((args) => {
      const sc = {
        id: `sc-${backend.state.sideChannels.length + 1}`,
        prompt: args?.prompt,
        status: 'running',
        started_at: nowIso(),
      };
      backend.state.sideChannels.push(sc);
      return sc;
    }),
  );
  handle('reflect_get_side_channel', handler(() => backend.state.sideChannels[0] ?? null));
  handle(
    'reflect_cancel_side_channel',
    handler((args) => {
      backend.state.sideChannels = backend.state.sideChannels.filter((s) => s.id !== args?.id);
      return true;
    }),
  );

  // —— workspaces ——
  handle('reflect_list_workspaces', handler(() => wire(backend.state.workspaces)));
  handle(
    'reflect_set_workspace',
    handler((args) => {
      const path = String(args?.path ?? '');
      backend.state.workspaces = backend.state.workspaces.filter((w) => w.path !== path);
      backend.state.workspaces.unshift({
        path,
        label: path.split('/').pop() ?? path,
        last_used: Math.floor(Date.now() / 1000),
        session_count: 0,
      });
    }),
  );
  handle('reflect_current_workspace', handler(() => backend.state.workspaces[0]?.path ?? '/Users/dev/project'));
  handle('reflect_pick_workspace_folder', handler(() => backend.state.pickedFolder));
  handle('reflect_pick_file', handler(() => backend.state.pickedFile));
  handle('reflect_reveal_path', handler(() => undefined));

  // —— traces(本地 LLM 调用记录只读查询)——
  handle('reflect_list_traces', handler(() => [
    {
      sessionId: '11111111-2222-3333-4444-555555555555',
      title: 'demo-session',
      calls: 3,
      lastAt: '2026-01-01T00:00:00Z',
      model: 'test-model',
      lastSource: 'main_turn',
    },
  ]));
  handle('reflect_get_trace', handler(() => [
    {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:01Z',
      durationMs: 1000,
      attempt: 1,
      requestId: 'req-1',
      traceId: 'trace-1',
      turnId: null,
      querySource: 'main_turn',
      model: { modelId: 'test-model', providerId: 'test', role: null, source: 'main_turn' },
      request: { message_count: 1 },
      response: { finish_reason: 'stop' },
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cached_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 15,
      },
    },
  ]));

  // —— stats(会话统计 / 模型级用量)——
  handle('reflect_session_stats', handler(() => ({
    sessionId: '11111111-2222-3333-4444-555555555555',
    model: 'openai/gpt-4o',
    startedAt: '2026-01-01T00:00:00Z',
    messageCount: 12,
    toolCalls: 3,
    compactions: 1,
    compactionBeforeTokens: 9000,
    compactionAfterTokens: 2000,
    compactionTokensSaved: 7000,
    memoryReads: 2,
    memoryWrites: 1,
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 250,
    cacheWriteTokens: 0,
    totalTokens: 1200,
    costUsd: 0.0234,
    cacheHitRate: 0.25,
    perModel: [
      {
        model: 'openai/gpt-4o',
        provider: 'openai',
        calls: 4,
        inputTokens: 1000,
        outputTokens: 200,
        cachedTokens: 250,
        cacheWriteTokens: 0,
        totalTokens: 1200,
        costUsd: 0.0234,
      },
    ],
  })));
  handle('reflect_all_model_usage', handler(() => [
    {
      model: 'openai/gpt-4o',
      provider: 'openai',
      calls: 4,
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 250,
      cacheWriteTokens: 0,
      totalTokens: 1200,
      costUsd: 0.0234,
    },
  ]));

  // —— prompts(提示词层管理)——
  handle('reflect_prompt_command', handler(() => 'sub-prompt-1'));
  handle('reflect_get_effective_prompt', handler(() => ({
    model: 'anthropic/claude-sonnet-4-latest',
    layers: ['my-layer'],
    sections: [
      {
        key: 'system.main',
        content: '你是一名编码助手。',
      },
    ],
  })));

  // —— 活跃 agent(运行时实际加载的那条定义)——
  // 活跃 agent 快照：名称来自状态，defFound 取决于 agentDefs 里是否真有该定义。
  const activeAgentSnapshot = () => {
    const name = backend.state.activeAgent;
    const defFound = backend.state.agentDefs.some((d) => d.name === name);
    return {
      name,
      defFound,
      memoryScopes: defFound ? ['project'] : [],
      injectBudgetChars: 8000,
      memoryPaths: [
        { scope: 'project', path: `/tmp/project/.zhuye/agent-memory/${name}/MEMORY.md` },
        { scope: 'user', path: `/tmp/home/.zhuye/agent-memory/${name}/MEMORY.md` },
      ],
    };
  };
  handle('reflect_get_active_agent', handler(() => activeAgentSnapshot()));
  handle(
    'reflect_set_active_agent',
    handler((args) => {
      backend.state.activeAgent = (args as { name?: string })?.name ?? 'default';
      return activeAgentSnapshot();
    }),
  );

  // —— MCP 服务管理(增删 + 精选 catalog)——
  handle('reflect_list_mcp_servers', handler(() => wire(backend.state.mcpServers)));
  handle('reflect_mcp_catalog', handler(() => [
    {
      id: 'filesystem',
      name: 'Filesystem',
      description: '本地文件读写 MCP server',
      category: 'files',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      installHint: 'npx -y @modelcontextprotocol/server-filesystem',
    },
  ]));
  // upsert 按 name 覆盖；entry 形状对齐真后端 McpServerEntry（{type, command, args} / {type, url}），
  // 列表项补上前端消费的 transport / running 字段。
  handle(
    'reflect_upsert_mcp_server',
    handler((args) => {
      const name = String(args?.name ?? '');
      const entry = (args?.entry ?? {}) as Record<string, unknown>;
      const item = {
        name,
        transport: entry.type ?? 'stdio',
        command: entry.command ?? null,
        args: entry.args ?? [],
        url: entry.url ?? null,
        running: false,
      };
      backend.state.mcpServers = backend.state.mcpServers.filter((s) => s.name !== name);
      backend.state.mcpServers.push(item);
    }),
  );
  handle(
    'reflect_delete_mcp_server',
    handler((args) => {
      backend.state.mcpServers = backend.state.mcpServers.filter((s) => s.name !== args?.name);
    }),
  );
  handle('reflect_list_mcp_resources', handler(() => [
    {
      server: 'filesystem',
      name: 'readme',
      uri: 'file:///tmp/readme.md',
      description: '项目说明',
      mimeType: 'text/markdown',
    },
  ]));
  handle('reflect_list_mcp_prompts', handler(() => [
    {
      server: 'filesystem',
      name: 'summarize',
      description: '总结一个目录',
      arguments: ['path'],
    },
  ]));

  // —— 安全扫描(cargo audit)——
  handle('reflect_run_security_scan', handler(() => ({
    ran: true,
    exitCode: 0,
    output: '0 vulnerabilities found',
    summary: 'cargo audit: 0 vulnerabilities',
  })));

  // —— Pipeline 配置编辑(校验 / 列表 / 落盘)——
  handle('reflect_validate_pipeline', handler(() => ({
    name: 'my-pipeline',
    failurePolicy: 'abort',
    nodes: ['plan', 'build'],
    nodeCount: 2,
    missingTeams: [],
    valid: true,
    error: null,
  })));
  handle('reflect_list_pipeline_configs', handler(() => wire(backend.state.pipelineConfigs)));
  handle(
    'reflect_save_pipeline_config',
    handler((args) => {
      const a = args as { name?: string; tomlSrc?: string };
      const name = a?.name ?? 'my-pipeline';
      const saved = { name, path: `/tmp/home/.zhuye/pipelines/${name}.toml`, toml: a?.tomlSrc ?? '' };
      backend.state.pipelineConfigs = backend.state.pipelineConfigs.filter((p) => p.name !== name);
      backend.state.pipelineConfigs.push(saved);
      return saved;
    }),
  );

  // —— hook 事件类型(可挂载时机 + 可用决策)——
  handle('reflect_list_hook_events', handler(() => [
    {
      kind: 'pre_tool_use',
      description: '工具执行前',
      decisions: ['allow', 'deny', 'modify_args', 'inject_message', 'permission_override', 'ask'],
    },
    {
      kind: 'post_tool_use',
      description: '工具执行后（仅通知）',
      decisions: [],
    },
    {
      kind: 'stop',
      description: '回合结束（注入消息仅在否决结束时生效）',
      decisions: ['allow', 'deny', 'inject_message'],
    },
  ]));

  // —— 子代理 spec(`call_<role>` 工具的来源)——
  handle('reflect_list_subagent_specs', handler(() => [
    {
      role: 'explorer',
      name: 'Explorer',
      model: null,
      systemPrompt: 'You are an explorer subagent.',
      allowedTools: ['bash', 'read', 'grep'],
      allowedSkills: [],
      maxTurns: null,
      source: 'builtin',
      path: null,
    },
    ...Object.keys(backend.state.subagentSpecs)
      .filter((role) => role !== 'explorer')
      .map((role) => ({
        role,
        name: role,
        model: null,
        systemPrompt: '',
        allowedTools: [],
        allowedSkills: [],
        maxTurns: null,
        source: 'user',
        path: `/tmp/home/.zhuye/agents/${role}.md`,
      })),
  ]));
  // 与真后端一致：get 返回 markdown 原文，未知 role 为 null；save 落 role → markdown；delete 后读为 null。
  handle(
    'reflect_get_subagent_spec',
    handler((args) => backend.state.subagentSpecs[String(args?.role ?? '')] ?? null),
  );
  handle(
    'reflect_save_subagent_spec',
    handler((args) => {
      backend.state.subagentSpecs[String(args?.role ?? '')] = String(args?.markdown ?? '');
    }),
  );
  handle(
    'reflect_delete_subagent_spec',
    handler((args) => {
      delete backend.state.subagentSpecs[String(args?.role ?? '')];
    }),
  );

  // —— git worktree(隔离工作树 + 滞留改动告警)——
  handle('reflect_list_worktrees', handler(() => [
    {
      path: '/tmp/project',
      branch: 'main',
      head: 'abc1234',
      dirty: false,
      isolated: false,
      stranded: false,
    },
    {
      path: '/tmp/project/.zhuye/worktrees/reflect-wt-1',
      branch: 'reflect/wt-1',
      head: 'def5678',
      dirty: true,
      isolated: true,
      stranded: true,
    },
  ]));

  // —— 运行时状态(凭证池 / 已完成子代理调用 / 记忆分段 / 配置位置)——
  handle('reflect_credential_pool_status', handler(() => [
    {
      provider: 'anthropic',
      total: 3,
      healthy: 2,
      healthyLabels: ['default', 'backup'],
    },
  ]));
  handle('reflect_recovery_state', handler(() => [
    {
      toolName: 'call_explorer',
      taskSummary: 'find the auth flow',
      resultSummary: 'src/auth/session.ts',
      iteration: 2,
      createdAt: '2026-10-01T00:00:00Z',
    },
  ]));
  handle('reflect_memory_sections', handler((args) => {
    checkMemoryContext(args);
    const sections: Array<{ scope: string; title: string; body: string; index: number; chars: number }> = [];
    for (const scope of ['project', 'user']) {
      const entries = backend.state.memory.filter((entry) => entry.scope === scope);
      const emit = (title: string, body: string) => {
        const trimmed = body.trimEnd();
        sections.push({ scope, title, body: trimmed, index: sections.filter((s) => s.scope === scope).length, chars: Array.from(trimmed).length });
      };
      for (const entry of entries) {
        if (!entry.wholeDocument) { emit(entry.key, entry.value); continue; }
        let title = '';
        let body = '';
        let hasContent = false;
        for (const line of entry.value.split(/\r?\n/)) {
          if (line.startsWith('## ')) {
            if (hasContent) emit(title, body);
            title = line.slice(3).trim(); body = ''; hasContent = true;
          } else { body += `${line}\n`; hasContent = true; }
        }
        if (hasContent) emit(title, body);
      }
    }
    return sections;
  }));
  handle('reflect_config_info', handler(() => ({
    path: '/tmp/home/.zhuye/config.toml',
    exists: true,
    analyticsEnabled: false,
    analyticsStatus: 'analytics: disabled',
    workspace: '/tmp/project',
    activeAgent: 'default',
  })));

  // —— 插件管理(列表 / 启停 / 卸载 / 本地安装)——
  handle('reflect_list_plugins', handler(() => [
    {
      id: 'demo',
      version: '0.1.0',
      scope: 'user',
      installPath: '/tmp/plugins/demo',
      installedAt: '2026-10-01T00:00:00Z',
      enabled: true,
      gitCommitSha: null,
    },
  ]));
  handle('reflect_list_marketplaces', handler(() => [
    {
      name: 'local',
      source: 'directory',
      installLocation: '/tmp/marketplaces',
      autoUpdate: false,
    },
  ]));
  handle('reflect_toggle_plugin', handler(() => undefined));
  handle('reflect_uninstall_plugin', handler(() => undefined));
  handle('reflect_install_plugin', handler(() => undefined));

  // —— 权限规则(核心三层 store 的生效规则)——
  handle('reflect_list_permission_rules', handler(() => wire(backend.state.permissionRules)));
  // 审批弹窗的「始终允许这条命令」—— 写进核心的用户级权限文件；
  // 列表项形状对齐真后端（tool / action / toolGlob / shellPattern / scope）。
  handle(
    'reflect_add_permission_rule',
    handler((args) => {
      const rule = (args?.rule ?? {}) as Record<string, unknown>;
      backend.state.permissionRules.push({
        tool: rule.tool ?? '',
        action: rule.action ?? 'allow',
        toolGlob: rule.toolGlob ?? null,
        shellPattern: rule.shellPattern ?? null,
        scope: 'user',
      });
    }),
  );

  // —— 会话笔记(agent 写下的持久结论)——
  handle('reflect_list_session_notes', handler(() => [
    { text: 'The auth flow lives in src/auth/session.ts', createdAt: '2026-10-01T00:00:00Z' },
  ]));
  handle('reflect_list_note_sessions', handler(() => [
    {
      sessionId: '11111111-2222-3333-4444-555555555555',
      count: 1,
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ]));

  // —— 费率卡(核心静态费率表反解)——
  handle('reflect_model_rate_cards', handler((args) => {
    const models = (args as { models?: string[] } | undefined)?.models ?? [];
    return models.map((model) => ({
      model,
      priced: model.includes('claude-sonnet-4-latest'),
      inputPrice: model.includes('claude-sonnet-4-latest') ? 3 : null,
      outputFactor: model.includes('claude-sonnet-4-latest') ? 5 : null,
      cacheReadFactor: model.includes('claude-sonnet-4-latest') ? 0.1 : null,
      cacheWriteFactor: model.includes('claude-sonnet-4-latest') ? 1.25 : null,
      outputPrice: model.includes('claude-sonnet-4-latest') ? 15 : null,
      cacheReadPrice: model.includes('claude-sonnet-4-latest') ? 0.3 : null,
      cacheWritePrice: model.includes('claude-sonnet-4-latest') ? 3.75 : null,
    }));
  }));

  // —— OS 沙箱有效状态 ——
  handle('reflect_sandbox_status', handler(() => ({
    osLevel: true,
    status: 'seatbelt',
    active: true,
    backend: 'seatbelt',
    statusLine: 'os-sandbox: seatbelt 已启用;网络:拒绝;敏感读:默认拒绝(凭据/SSH/钥匙串);strict=true',
    enabled: true,
    envOverride: null,
  })));

  // —— span 日志(turn → model → tool 父子链)——
  handle('reflect_list_span_logs', handler(() => [
    { day: '2026-10-01', path: '/tmp/traces/log/reflect-2026-10-01.jsonl' },
  ]));
  handle('reflect_read_span_log', handler(() => [
    {
      spanId: 'span-turn',
      parentSpanId: null,
      event: 'turn.started',
      module: 'reflect_core::submission_loop',
      level: 'info',
      status: 'started',
      turnId: 't1',
      toolCallId: null,
      sessionId: '11111111-2222-3333-4444-555555555555',
      durationMs: null,
      timestamp: '2026-10-01T00:00:00Z',
      context: null,
      depth: 0,
    },
    {
      spanId: 'span-model',
      parentSpanId: 'span-turn',
      event: 'model.request.completed',
      module: 'reflect_core::graph::nodes::model_call',
      level: 'info',
      status: 'completed',
      turnId: 't1',
      toolCallId: null,
      sessionId: '11111111-2222-3333-4444-555555555555',
      durationMs: 1200,
      timestamp: '2026-10-01T00:00:01Z',
      context: null,
      depth: 1,
    },
  ]));

  // —— discussion(多 agent 讨论)——
  handle('reflect_list_discussions', handler(() => [
    {
      sessionId: '11111111-2222-3333-4444-555555555555',
      title: 'demo-session',
      model: 'test-model',
      startedAt: '2026-01-01T00:00:00Z',
      messageCount: 4,
    },
  ]));
  handle('reflect_run_discussion', handler(() => ({
    discussionId: '99999999-8888-7777-6666-555555555555',
    participants: ['advocate', 'skeptic'],
    transcript: '=== Discussion Transcript ===',
    result: { consensus: false, rounds: 1 },
    llmBacked: false,
  })));
  handle('reflect_cancel_discussions', handler(() => 0));

  // —— pipeline(DAG 流水线)——
  handle('reflect_run_team_pipeline', handler(() => ({
    topic: 'demo',
    status: 'success',
    failure_policy: 'abort',
    nodes: [{ name: 'plan', status: 'Success', outputs: {}, elapsed_ms: 1, started_at_ms: 0 }],
    total_elapsed_ms: 1,
  })));
  handle('reflect_run_pipeline', handler(() => ({
    topic: 'demo',
    status: 'success',
    failure_policy: 'abort',
    nodes: [{ name: 'plan', status: 'Success', outputs: {}, elapsed_ms: 1, started_at_ms: 0 }],
    total_elapsed_ms: 1,
  })));

  // —— activity ——
  handle('reflect_list_activity', handler(() => wire(backend.state.activity)));
  handle('reflect_search_activity', handler(() => wire(backend.state.activity)));
  handle('reflect_clear_activity', handler(() => {
    backend.state.activity = [];
  }));
  handle('reflect_activity_count', handler(() => backend.state.activity.length));

  // —— agent defs ——
  handle('reflect_list_agent_defs', handler(() => wire(backend.state.agentDefs)));
  handle(
    'reflect_get_agent_def',
    handler((args) => backend.state.agentDefs.find((d) => d.name === args?.name) ?? null),
  );
  handle(
    'reflect_save_agent_def',
    handler((args) => {
      const def = args?.def as Record<string, unknown> | undefined;
      if (def) {
        if (args?.createOnly && backend.state.agentDefs.some((d) => d.name === def.name)) {
          throw new Error(`agent definition already exists: ${String(def.name)}`);
        }
        backend.state.agentDefs = backend.state.agentDefs.filter((d) => d.name !== def.name);
        backend.state.agentDefs.push(def);
      }
      return def;
    }),
  );
  handle(
    'reflect_delete_agent_def',
    handler((args) => {
      backend.state.agentDefs = backend.state.agentDefs.filter((d) => d.name !== args?.name);
      return true;
    }),
  );
  handle('reflect_parse_agent_md', handler(() => backend.state.agentDefs[0] ?? null));

  // —— allowlist ——
  // 线格式与 `src-tauri/src/commands/allowlist.rs` 对齐：键是 `prefixes`；
  // save 时修剪空白 / 丢弃空项 / 去重 / 按字典序排序 / 截断 1024 条；
  // check 是「目标以任一 prefix 开头」的前缀匹配，空目标恒为 false。
  handle('reflect_load_allowlist', handler(() => wire(backend.state.allowlist)));
  handle(
    'reflect_save_allowlist',
    handler((args) => {
      const raw = (args?.list as { prefixes?: string[] } | undefined)?.prefixes ?? [];
      const cleaned = Array.from(new Set(raw.map((p) => p.trim()).filter((p) => p.length > 0)));
      cleaned.sort();
      backend.state.allowlist = { prefixes: cleaned.slice(0, 1024) };
    }),
  );
  handle(
    'reflect_check_allowlist',
    handler((args) => {
      const target = String(args?.prefix ?? '').trim();
      if (!target) return false;
      return backend.state.allowlist.prefixes.some((p) => target.startsWith(p));
    }),
  );

  // —— kms / 知识库 ——
  // 页面名称是逻辑名称，包含 .md 时不会被剥离。
  const pageKey = (wiki: unknown, page: unknown) =>
    `${String(wiki ?? '')}/${String(page ?? '')}`;
  const pageResult = (wiki: string, name: string, page: { title: string | null; content: string; tags: string[] }) =>
    ({ name, wiki, content: page.content, title: page.title, tags: page.tags, modifiedAtMs: 0 });
  const wikiResult = (wiki: { name: string; description: string }) => ({ ...wiki, path: `/kms/${wiki.name}`, pageCount: Object.keys(backend.state.wikiPages).filter((key) => key.startsWith(`${wiki.name}/`)).length, modifiedAtMs: 0 });
  handle('reflect_kms_list', handler(() => wire(backend.state.wikis.map(wikiResult))));
  handle(
    'reflect_kms_create',
    handler((args) => {
      const name = String(args?.name ?? '');
      const description = String(args?.description ?? '');
      // 与真后端一致:重名报错,不静默覆盖。
      if (backend.state.wikis.some((w) => w.name === name)) {
        throw new Error(`Wiki already exists: ${name}`);
      }
      const wiki = { name, description };
      backend.state.wikis.push(wiki);
      return wikiResult(wiki);
    }),
  );
  handle(
    'reflect_kms_delete',
    handler((args) => {
      const name = String(args?.name ?? '');
      backend.state.wikis = backend.state.wikis.filter((w) => w.name !== name);
      for (const key of Object.keys(backend.state.wikiPages)) {
        if (key.startsWith(`${name}/`)) delete backend.state.wikiPages[key];
      }
    }),
  );
  handle(
    'reflect_kms_list_pages',
    handler((args) => {
      // 线格式对齐真后端 Vec<Page>:对象数组(name 不含 .md),不是文件名字符串。
      const wiki = String(args?.wiki ?? '');
      if (!backend.state.wikis.some((item) => item.name === wiki)) throw new Error(`Wiki not found: ${wiki}`);
      const prefix = `${wiki}/`;
      const saved = Object.keys(backend.state.wikiPages)
        .filter((k) => k.startsWith(prefix))
        .map((k) => {
          const page = backend.state.wikiPages[k];
          return pageResult(wiki, k.slice(prefix.length), page);
        });
      return wire(saved);
    }),
  );
  handle(
    'reflect_kms_get_page',
    handler((args) => {
      const wiki = String(args?.wiki ?? '');
      const name = String(args?.page ?? '');
      const page = backend.state.wikiPages[pageKey(wiki, name)];
      if (!page) throw new Error(`Page not found: ${wiki}/${name}`);
      return wire(pageResult(wiki, name, page));
    }),
  );
  handle(
    'reflect_kms_save_page',
    handler((args) => {
      const wiki = String(args?.wiki ?? '');
      const name = String(args?.page ?? '');
      if (!backend.state.wikis.some((item) => item.name === wiki)) throw new Error(`Wiki not found: ${wiki}`);
      if (args?.createOnly === true && backend.state.wikiPages[pageKey(wiki, name)]) throw new Error(`Page already exists: ${wiki}/${name}`);
      if (args?.createOnly === true && typeof args?.expectedContent === 'string') throw new Error('createOnly and expectedContent cannot be combined');
      if (typeof args?.expectedContent === 'string' && backend.state.wikiPages[pageKey(wiki, name)]?.content !== args.expectedContent) throw new Error(`Page changed or was deleted: ${wiki}/${name}`);
      const title = typeof args?.title === 'string' ? args.title : null;
      const tags = Array.isArray(args?.tags) ? args.tags as string[] : [];
      const body = String(args?.content ?? '');
      const content = title !== null || tags.length > 0
        ? `---\n${title !== null ? `title: ${title}\n` : ''}${tags.length ? `tags: [${tags.join(', ')}]\n` : ''}---\n${body}` : body;
      const header = content.startsWith('---\n') ? content.slice(4).split('\n---\n', 1)[0] : '';
      const stored = {
        title: header.match(/^title: (.+)$/m)?.[1]?.trim() || null,
        content,
        tags: header.match(/^tags: \[(.*)\]$/m)?.[1]?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? [],
      };
      backend.state.wikiPages[pageKey(wiki, name)] = stored;
      return wire(pageResult(wiki, name, stored));
    }),
  );
  handle('reflect_kms_search', handler((args) => {
    const query = String(args?.query ?? '');
    return Object.entries(backend.state.wikiPages).flatMap(([key, page]) => {
      const slash = key.indexOf('/');
      const lines = page.content.split('\n').filter((line) => line.includes(query));
      return lines.length ? [{ wiki: key.slice(0, slash), page: key.slice(slash + 1), lines, lineCount: lines.length }] : [];
    });
  }));
  handle('reflect_dream', handler(() => undefined));

  // —— media / computer use ——
  handle('reflect_list_media', handler(() => [
    { path: '/assets/logo.png', name: 'logo.png', kind: 'image', size: 2048 },
  ]));
  handle('reflect_media_capabilities', handler(() => ({ screenshots: true, image_process: true })));
  handle('reflect_screenshot', handler(() => 'data:image/png;base64,xyz'));
  handle('reflect_image_process', handler(() => ({ output_path: '/tmp/out.png' })));
  handle('reflect_computer_use', handler(() => undefined));

  // —— remote / tailscale ——
  // 线格式与真后端 `RemoteConfigSnapshot` 一致（camelCase：authToken / autoConnect / isReady）；
  // update 的入参同样是 camelCase（Tauri 按 camelCase 取 Rust 参数），与 `src/utils/commands/remote.ts` 对齐。
  const remoteSnapshot = () => {
    const c = backend.state.remoteConfig;
    return wire({ ...c, endpoint: c.host ? `${c.host}:${c.port}` : '', isReady: Boolean(c.host) });
  };
  handle('reflect_get_remote_config', handler(() => remoteSnapshot()));
  handle(
    'reflect_update_remote_config',
    handler((args) => {
      const c = backend.state.remoteConfig;
      c.host = String(args?.host ?? c.host);
      if (args?.port !== undefined && args?.port !== null) c.port = Number(args.port);
      if (args?.authToken !== undefined) c.authToken = (args.authToken as string | null) ?? null;
      if (args?.autoConnect !== undefined && args?.autoConnect !== null) c.autoConnect = Boolean(args.autoConnect);
      return remoteSnapshot();
    }),
  );
  handle('reflect_get_remote_status', handler(() => ({
    state: 'disconnected',
    message: null,
    endpoint: null,
    sinceMs: null,
  })));
  // 线契约见 src/utils/commands/remote.ts::ReflectTailscaleStatus ——
  // ipv4/ipv6 等字段必须存在（此前缺 ipv4 会让 RemoteView 在数据先于
  // 断言到达时读 `undefined.length` 崩溃,表现为重负载下的偶发失败）。
  handle(
    'reflect_tailscale_status',
    // 线格式与 `app_core::tailscale::TailscaleStatus` 一致（camelCase）。
    handler(() => ({
      installed: false,
      running: false,
      version: null,
      dnsName: null,
      hostName: null,
      tailnetName: null,
      ipv4: [],
      ipv6: [],
      suggestedRemoteHost: null,
      message: null,
    })),
  );
  handle('reflect_tailscale_daemon_command_preview', handler(() => 'tailscale up'));
  handle('reflect_tailscale_daemon_start', handler(() => 'started'));
  handle('reflect_tailscale_daemon_stop', handler(() => 'stopped'));
  handle('reflect_tailscale_daemon_status', handler(() => 'inactive'));

  // —— updates / autopilot ——
  // 形状对齐后端 `UpdateInfo`(camelCase 出线)。
  handle('reflect_check_update', handler(() => ({
    currentVersion: '0.1.0',
    latestVersion: '0.1.0',
    updateAvailable: false,
    releaseUrl: null,
    releaseNotes: null,
    probedAt: 0,
    error: null,
  })));
  // 线格式与 `app-core::autopilot::AutopilotConfig` 一致（camelCase）；update 落状态后读回。
  handle('reflect_get_autopilot_config', handler(() => wire(backend.state.autopilotConfig)));
  handle(
    'reflect_update_autopilot_config',
    handler((args) => {
      backend.state.autopilotConfig = { ...backend.state.autopilotConfig, ...((args?.config ?? {}) as Record<string, unknown>) };
      return wire(backend.state.autopilotConfig);
    }),
  );
  handle('reflect_autopilot_history', handler(() => []));

  return backend;
}

/**
 * 在应用挂载后发送初始 session_configured 事件 —— 复刻真实后端
 * 启动即广播会话配置的行为。须在 AppProviders 的订阅建立之后调用。
 */
export function emitSessionConfigured(backend: FakeBackend): void {
  void backend;
  emitEvent('', {
    type: 'session_configured',
    session_id: 'sess-alpha',
    model: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    approval_policy: 'prompt',
    sandbox_policy: 'read_only',
    context_window_size: 200_000,
  });
}
