/**
 * 路由矩阵共享表 —— `views.route-matrix.test.tsx`（行为矩阵）与
 * `a11y.route-matrix.test.tsx`（axe 审计）消费同一份表，
 * 新增路由时两边自动跟进。
 */
export interface RouteSpec {
  route: string;
  /** 挂载后应被调用的命令（数据管道接通证据）。 */
  commands?: string[];
  /** fixture 中应渲染进 DOM 的关键文本。 */
  shows?: string[];
}

export const ROUTES: RouteSpec[] = [
  { route: '/', commands: ['zhuye_list_sessions'] },
  { route: '/home' },
  { route: '/chat' },
  {
    route: '/sessions',
    commands: ['zhuye_list_sessions'],
  },
  {
    route: '/settings',
    commands: ['zhuye_get_config', 'zhuye_agent_status'],
    shows: ['anthropic/claude-sonnet-4'],
  },
  {
    route: '/files',
    commands: ['zhuye_list_dir'],
    shows: ['README.md'],
  },
  {
    route: '/models',
    commands: ['zhuye_agent_status'],
  },
  {
    route: '/skills',
    commands: ['zhuye_list_tools'],
    shows: ['read_file'],
  },
  {
    // WorkspacesView 由 workspaces.json 历史驱动；当前工作区来自 agent-status。
    route: '/workspaces',
    commands: ['zhuye_list_workspaces', 'zhuye_agent_status'],
    shows: ['/Users/dev/project'],
  },
  {
    route: '/git',
    commands: ['zhuye_git_status', 'zhuye_git_diff', 'zhuye_git_log'],
    shows: ['feat: parser'],
  },
  {
    // P3：拉取请求（gh CLI）；fakeBackend 默认空列表。
    route: '/pulls',
    commands: ['zhuye_gh_pr_list'],
  },
  {
    // P3：hooks 运行时启停面板。
    route: '/hooks',
    commands: ['zhuye_list_hooks'],
  },
  { route: '/terminal' },
  { route: '/plan' },
  { route: '/prompts' },
  { route: '/about', commands: ['zhuye_agent_status'] },
  {
    // 默认 tab 为 inbox；activity 查询按 tab 启用。
    route: '/notifications',
  },
  { route: '/debug' },
  { route: '/apps' },
  { route: '/preview' },
  { route: '/browser', commands: ['zhuye_browser_status'] },
  {
    route: '/collaboration',
    commands: ['zhuye_list_tools'],
  },
  { route: '/mobile' },
  { route: '/dictation' },
  {
    // section 名是 data-section 属性，不进 textContent（细节由其专属测试覆盖）。
    route: '/design-system',
  },
  {
    route: '/memory',
    commands: ['zhuye_list_memory'],
    shows: ['build-cmd'],
  },
  { route: '/search' },
  {
    route: '/tasks',
    commands: ['zhuye_list_tasks'],
    shows: ['Ship v2'],
  },
  {
    route: '/schedule',
    commands: ['zhuye_list_schedules'],
    shows: ['run the nightly build'],
  },
  {
    route: '/agents',
    commands: ['zhuye_list_agent_defs'],
    shows: ['reviewer'],
  },
  {
    route: '/side-channels',
    commands: ['zhuye_list_side_channels'],
    shows: ['background research'],
  },
  {
    route: '/remote',
    commands: ['zhuye_get_remote_status'],
  },
  {
    route: '/kms',
    commands: ['zhuye_kms_list'],
    shows: ['engineering'],
  },
  {
    route: '/autopilot',
    commands: ['zhuye_get_autopilot_config'],
  },
  {
    // tasks 查询仅在选中 squad 后启用（enabled: !!selectedName）。
    route: '/squad',
    commands: ['zhuye_list_squads'],
    shows: ['rocket'],
  },
  { route: '/media' },
  {
    route: '/traces',
    commands: ['zhuye_list_traces'],
    shows: ['demo-session'],
  },
  {
    route: '/usage',
    commands: ['zhuye_all_model_usage'],
    shows: ['openai/gpt-4o'],
  },
  {
    route: '/collaboration',
    commands: ['zhuye_list_discussions'],
    shows: ['demo-session'],
  },
  {
    // market：三源合并卡片（MCP / 插件 / 技能）。
    route: '/market',
    commands: ['zhuye_list_mcp_servers', 'zhuye_list_plugins', 'zhuye_list_skills'],
  },
  {
    // lanes：子代理泳道（快照经 subagent_status 事件异步到达，空态即可）。
    route: '/lanes',
    commands: ['zhuye_list_side_channels'],
  },
  {
    route: '/chat/sess-alpha',
    commands: ['zhuye_replay_session'],
    shows: ['Summarize the auth flow'],
  },
];
