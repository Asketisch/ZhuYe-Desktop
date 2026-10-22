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
  { route: '/', commands: ['reflect_list_sessions'] },
  { route: '/home' },
  { route: '/chat' },
  {
    route: '/sessions',
    commands: ['reflect_list_sessions'],
  },
  {
    route: '/settings',
    commands: ['reflect_get_config', 'reflect_agent_status'],
    shows: ['anthropic/claude-sonnet-4'],
  },
  {
    route: '/files',
    commands: ['reflect_list_dir'],
    shows: ['README.md'],
  },
  {
    route: '/models',
    commands: ['reflect_agent_status'],
  },
  {
    route: '/skills',
    commands: ['reflect_list_tools'],
    shows: ['read_file'],
  },
  {
    // WorkspacesView 由 workspaces.json 历史驱动；当前工作区来自 agent-status。
    route: '/workspaces',
    commands: ['reflect_list_workspaces', 'reflect_agent_status'],
    shows: ['/Users/dev/project'],
  },
  {
    route: '/git',
    commands: ['reflect_git_status', 'reflect_git_diff', 'reflect_git_log'],
    shows: ['feat: parser'],
  },
  {
    // P3：拉取请求（gh CLI）；fakeBackend 默认空列表。
    route: '/pulls',
    commands: ['reflect_gh_pr_list'],
  },
  {
    // P3：hooks 运行时启停面板。
    route: '/hooks',
    commands: ['reflect_list_hooks'],
  },
  { route: '/terminal' },
  { route: '/plan' },
  { route: '/prompts' },
  { route: '/about', commands: ['reflect_agent_status'] },
  {
    // 默认 tab 为 inbox；activity 查询按 tab 启用。
    route: '/notifications',
  },
  { route: '/debug' },
  { route: '/apps' },
  {
    route: '/collaboration',
    commands: ['reflect_list_tools'],
  },
  { route: '/mobile' },
  { route: '/dictation' },
  {
    // section 名是 data-section 属性，不进 textContent（细节由其专属测试覆盖）。
    route: '/design-system',
  },
  {
    route: '/memory',
    commands: ['reflect_list_memory'],
    shows: ['build-cmd'],
  },
  { route: '/search' },
  {
    route: '/tasks',
    commands: ['reflect_list_tasks'],
    shows: ['Ship v2'],
  },
  {
    route: '/schedule',
    commands: ['reflect_list_schedules'],
    shows: ['run the nightly build'],
  },
  {
    route: '/agents',
    commands: ['reflect_list_agent_defs'],
    shows: ['reviewer'],
  },
  {
    route: '/side-channels',
    commands: ['reflect_list_side_channels'],
    shows: ['background research'],
  },
  {
    route: '/remote',
    commands: ['reflect_get_remote_status'],
  },
  {
    route: '/kms',
    commands: ['reflect_kms_list'],
    shows: ['engineering'],
  },
  {
    route: '/autopilot',
    commands: ['reflect_get_autopilot_config'],
  },
  {
    // tasks 查询仅在选中 squad 后启用（enabled: !!selectedName）。
    route: '/squad',
    commands: ['reflect_list_squads'],
    shows: ['rocket'],
  },
  { route: '/media' },
  {
    route: '/traces',
    commands: ['reflect_list_traces'],
    shows: ['demo-session'],
  },
  {
    route: '/usage',
    commands: ['reflect_all_model_usage'],
    shows: ['openai/gpt-4o'],
  },
  {
    route: '/collaboration',
    commands: ['reflect_list_discussions'],
    shows: ['demo-session'],
  },
  {
    route: '/chat/sess-alpha',
    commands: ['reflect_replay_session'],
    shows: ['Summarize the auth flow'],
  },
];
