/**
 * M1.5 Slash 命令静态列表 —— 镜像 `crates/reflect-tui/src/slash.rs` 的命令。
 *
 * Tier A (toolbar 显示) 7 个 + 剩余弹 popup。 M2.x 把 active command
 * 接到对应 Tauri command / API。
 *
 * summary 是 i18n key,渲染时通过 t(summaryKey) 拿到当前 locale 文本。
 *
 * v1.x P3 清理：纯 no-op stub（镜像 TUI 但 GUI 无对应实装/视图）标记
 * `hidden: true` —— 不再出现在弹层候选里（此前 50+ 个候选淹没有效命令）。
 * 命令仍留在数组中：手输 `/<name>` 时 engine 的引导提示照常生效。
 *
 * v1.x：`/theme` `/vim` 是纯 TUI 镜像 stub（GUI 无 vim 实装,主题切换
 * 由 Settings → Display / StatusBar / 命令面板承担），已从清单删除。
 */
export interface SlashCmd {
  name: string;
  aliases?: string[];
  category: 'theme' | 'mode' | 'model' | 'session' | 'memory' | 'tasks' | 'permissions' | 'skills' | 'shortcuts' | 'help' | 'system';
  summaryKey: string;
  toolbared?: boolean;
  /** true = 弹层不展示（no-op stub，手输仍给引导）。 */
  hidden?: boolean;
  /** 插件命令的真实说明文本 —— 有值时弹层直接渲染,不走 i18n summaryKey。 */
  description?: string;
}

export const SLASH_COMMANDS: SlashCmd[] = [
  { name: 'effort', category: 'mode', summaryKey: 'slash.effort.desc', toolbared: true },
  { name: 'compact', category: 'session', summaryKey: 'slash.compact.desc', toolbared: true },
  { name: 'mode', category: 'permissions', summaryKey: 'slash.mode.desc', toolbared: true },
  { name: 'model', category: 'model', summaryKey: 'slash.model.desc', toolbared: true },
  { name: 'provider', aliases: ['prov'], category: 'model', summaryKey: 'slash.provider.desc', toolbared: true },
  { name: 'status', category: 'system', summaryKey: 'slash.status.desc', toolbared: true },
  { name: 'help', aliases: ['?'], category: 'help', summaryKey: 'slash.help.desc', toolbared: true },

  { name: 'init', category: 'system', summaryKey: 'slash.init.desc', hidden: true },
  { name: 'clear', category: 'session', summaryKey: 'slash.clear.desc' },
  { name: 'interrupt', category: 'session', summaryKey: 'slash.interrupt.desc' },
  { name: 'resume', category: 'session', summaryKey: 'slash.resume.desc' },
  { name: 'rename', category: 'session', summaryKey: 'slash.rename.desc' },
  { name: 'export', category: 'session', summaryKey: 'slash.export.desc' },
  { name: 'share', category: 'session', summaryKey: 'slash.share.desc', hidden: true },
  { name: 'session', aliases: ['sessions'], category: 'session', summaryKey: 'slash.session.desc', hidden: true },
  { name: 'diff', category: 'system', summaryKey: 'slash.diff.desc', hidden: true },
  { name: 'files', category: 'system', summaryKey: 'slash.files.desc', hidden: true },
  { name: 'branch', category: 'system', summaryKey: 'slash.branch.desc', hidden: true },
  { name: 'commit', category: 'system', summaryKey: 'slash.commit.desc', hidden: true },
  { name: 'commit-push-pr', category: 'system', summaryKey: 'slash.commitPushPr.desc', hidden: true },
  { name: 'review', category: 'system', summaryKey: 'slash.review.desc', hidden: true },
  { name: 'ultrareview', category: 'system', summaryKey: 'slash.ultrareview.desc', hidden: true },
  { name: 'usage', category: 'system', summaryKey: 'slash.usage.desc' },
  { name: 'prompt', category: 'system', summaryKey: 'slash.prompt.desc' },
  { name: 'copy', category: 'shortcuts', summaryKey: 'slash.copy.desc', hidden: true },
  { name: 'editor', category: 'shortcuts', summaryKey: 'slash.editor.desc', hidden: true },
  { name: 'stats', category: 'system', summaryKey: 'slash.stats.desc', hidden: true },
  { name: 'insights', category: 'system', summaryKey: 'slash.insights.desc', hidden: true },
  { name: 'context', category: 'system', summaryKey: 'slash.context.desc' },
  { name: 'ctx_viz', aliases: ['ctxviz'], category: 'system', summaryKey: 'slash.ctxViz.desc', hidden: true },
  { name: 'color', category: 'theme', summaryKey: 'slash.color.desc', hidden: true },
  { name: 'sandbox-toggle', category: 'permissions', summaryKey: 'slash.sandboxToggle.desc', hidden: true },
  { name: 'memory', category: 'memory', summaryKey: 'slash.memory.desc', hidden: true },
  { name: 'hooks', category: 'system', summaryKey: 'slash.hooks.desc', hidden: true },
  { name: 'tasks', category: 'tasks', summaryKey: 'slash.tasks.desc', hidden: true },
  { name: 'permissions', category: 'permissions', summaryKey: 'slash.permissions.desc', hidden: true },
  { name: 'skills', category: 'skills', summaryKey: 'slash.skills.desc', hidden: true },
  { name: 'plan', category: 'mode', summaryKey: 'slash.enterPlan.desc' },
  { name: 'exit-plan', aliases: ['exitplan'], category: 'mode', summaryKey: 'slash.exitPlan.desc' },
  { name: 'goal', category: 'mode', summaryKey: 'slash.goal.desc' },
  { name: 'keybindings', aliases: ['keys', 'bindings'], category: 'shortcuts', summaryKey: 'slash.keybindings.desc', hidden: true },
  { name: 'statusline', aliases: ['status-line'], category: 'shortcuts', summaryKey: 'slash.statusline.desc', hidden: true },
  { name: 'output-style', category: 'shortcuts', summaryKey: 'slash.outputStyle.desc', hidden: true },
  { name: 'mcp', category: 'system', summaryKey: 'slash.mcp.desc', hidden: true },
  { name: 'plugin', category: 'system', summaryKey: 'slash.plugin.desc', hidden: true },
  { name: 'ide', category: 'system', summaryKey: 'slash.ide.desc', hidden: true },
  { name: 'desktop', category: 'system', summaryKey: 'slash.desktop.desc', hidden: true },
  { name: 'mobile', category: 'system', summaryKey: 'slash.mobile.desc', hidden: true },
  { name: 'exit', aliases: ['quit'], category: 'system', summaryKey: 'slash.exit.desc', hidden: true },
];

export const TIER_A_TOOLBAR = SLASH_COMMANDS.filter((c) => c.toolbared);

/**
 * 插件 slash 命令注册表 —— 由 `usePluginCommands` 从后端
 * (`reflect_list_plugin_commands`)拉取后写入,与挂载状态联动。
 *
 * 插件命令与内置命令的分界:内置命令由 `slashEngine.executeSlash` 本地
 * 执行;插件命令引擎不解析,`dispatch` 对其返回 PlainText 原样提交,
 * 由后端 submit 边界展开(`expand_submission`)—— 命令 md 的读取与
 * `$ARGUMENTS` 替换只在后端做,前端保持无 IO。
 */
export interface PluginSlashCommand {
  /** 命令全名(`plugin:ns:name` 形式,如 `demo:hello`)。 */
  name: string;
  /** 命令说明(md frontmatter `description`)。 */
  description: string | null;
}

let pluginCommands: PluginSlashCommand[] = [];

/** 覆写插件命令注册表(空数组 = 清空,退回纯内置列表)。 */
export function setPluginSlashCommands(commands: PluginSlashCommand[]): void {
  pluginCommands = commands;
}

export function getPluginSlashCommands(): PluginSlashCommand[] {
  return pluginCommands;
}

/** 输入的命令名是否为已挂载插件命令(精确匹配)。 */
export function isPluginCommand(name: string): boolean {
  const n = name.toLowerCase();
  return pluginCommands.some((c) => c.name.toLowerCase() === n);
}

/**
 * 弹层候选过滤：剔除 hidden stub + 按 query 前缀匹配（name / alias）。
 * Composer 与 SlashPopup 共用，保证「键盘选中项」与「渲染列表」同源。
 * 插件命令追加在内置命令之后,同样按前缀匹配。
 */
export function filterSlashCommands(query: string): SlashCmd[] {
  const q = query.toLowerCase().replace(/^\//, '');
  const visible = SLASH_COMMANDS.filter((c) => !c.hidden);
  const pluginMatches = pluginCommands
    .filter((c) => c.name.toLowerCase().startsWith(q))
    .map(
      (c): SlashCmd => ({
        name: c.name,
        category: 'system',
        summaryKey: '',
        description: c.description ?? undefined,
      }),
    );
  if (!q) return [...visible, ...pluginMatches];
  return [
    ...visible.filter(
      (c) =>
        c.name.toLowerCase().startsWith(q) ||
        c.aliases?.some((a) => a.toLowerCase().startsWith(q)),
    ),
    ...pluginMatches,
  ];
}
