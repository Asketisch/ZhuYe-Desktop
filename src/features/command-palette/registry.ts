/**
 * CommandPalette registry (B10-01).
 *
 * 每个 PaletteItem 是一个可执行的命令(导航到路由 / 触发 slash /
 * 触发主题切换 / 触发回调)。`kind` 决定默认分组,搜索按 label /
 * keywords 模糊匹配。
 *
 * **i18n**:`label` / `hint` 改为 i18n key,渲染时通过 `t(labelKey)` / `t(hintKey)` 拿到。
 */
import type { ComponentType } from 'react';
import {
  Home,
  MessagesSquare,
  Settings,
  FolderOpen,
  Cpu,
  Sparkles,
  Folder,
  GitBranch,
  Terminal as TerminalIcon,
  ListChecks,
  BookOpen,
  Bell,
  Wrench,
  Layers,
  Gauge,
  Smartphone,
  Mic,
  AppWindow,
  Users,
  Bug,
  Palette,
  Info,
  RefreshCw,
  Moon,
  Sun,
  Monitor,
  Plus,
  Trash2,
  Download,
  FileText,
  Save,
  Search,
  Brain,
  FolderKanban,
  Clock,
  Bot,
  Workflow,
  Wifi,
  Zap,
  Image as ImageIcon,
} from 'lucide-react';
import type { LocaleKey } from '@/utils/i18n';

export type PaletteItemKind =
  | 'navigation'
  | 'session'
  | 'slash'
  | 'theme'
  | 'system';

export interface PaletteItem {
  id: string;
  labelKey: LocaleKey;
  /** 可选的一行描述。 */
  hintKey?: LocaleKey;
  kind: PaletteItemKind;
  icon: ComponentType;
  /** 用于模糊搜索的自由文本关键词。 */
  keywords?: string[];
  /** 激活方式 —— 这些字段有且只有一个被设置。 */
  to?: string;
  slash?: string;
  run?: () => void;
  /** 数值越小列表越靠前。 */
  weight?: number;
}

/** 在打开时刻构建可用面板条目的快照。 */
export interface BuildPaletteArgs {
  navigate: (to: string) => void;
  cycleTheme: () => void;
  setTheme: (mode: 'light' | 'dark' | 'system') => void;
  resolvedTheme: 'light' | 'dark';
  newSession: () => void;
  clearAllSessions: () => void;
  exportActive: () => void;
  exportActiveMarkdown: () => void;
  saveConfig: () => void;
}

export function buildPaletteItems(args: BuildPaletteArgs): PaletteItem[] {
  const {
    cycleTheme, setTheme, resolvedTheme, newSession, clearAllSessions, exportActive,
    exportActiveMarkdown, saveConfig,
  } = args;
  return [
    // ---- Navigation ----
    { id: 'nav.home',        labelKey: 'palette.item.goHome',      kind: 'navigation', icon: Home,         to: '/home',        weight: 10 },
    { id: 'nav.chat',        labelKey: 'palette.item.goChat',      kind: 'navigation', icon: MessagesSquare, to: '/chat',        weight: 10 },
    { id: 'nav.sessions',    labelKey: 'palette.item.goSessions',  kind: 'navigation', icon: ListChecks,   to: '/sessions',    weight: 10 },
    { id: 'nav.settings',    labelKey: 'palette.item.goSettings',  kind: 'navigation', icon: Settings,     to: '/settings',    weight: 10 },
    { id: 'nav.files',       labelKey: 'palette.item.goFiles',     kind: 'navigation', icon: FolderOpen,   to: '/files',       weight: 10 },
    { id: 'nav.models',      labelKey: 'palette.item.goModels',    kind: 'navigation', icon: Cpu,          to: '/models',      weight: 10 },
    { id: 'nav.skills',      labelKey: 'palette.item.goSkills',    kind: 'navigation', icon: Sparkles,     to: '/skills',      weight: 10 },
    { id: 'nav.workspaces',  labelKey: 'palette.item.goWorkspaces', kind: 'navigation', icon: Folder,       to: '/workspaces',  weight: 10 },
    { id: 'nav.git',         labelKey: 'palette.item.goGit',       kind: 'navigation', icon: GitBranch,    to: '/git',         weight: 10 },
    { id: 'nav.terminal',    labelKey: 'palette.item.goTerminal',  kind: 'navigation', icon: TerminalIcon, to: '/terminal',    weight: 10 },
    { id: 'nav.plan',        labelKey: 'palette.item.goPlan',      kind: 'navigation', icon: ListChecks,   to: '/plan',        weight: 10 },
    { id: 'nav.prompts',     labelKey: 'palette.item.goPrompts',   kind: 'navigation', icon: BookOpen,     to: '/prompts',     weight: 10 },
    { id: 'nav.about',       labelKey: 'palette.item.goAbout',     kind: 'navigation', icon: Info,         to: '/about',       weight: 10 },
    { id: 'nav.notifications', labelKey: 'palette.item.goNotifications', kind: 'navigation', icon: Bell,      to: '/notifications', weight: 10 },
    { id: 'nav.debug',       labelKey: 'palette.item.goDebug',     kind: 'navigation', icon: Bug,          to: '/debug',       weight: 10 },
    { id: 'nav.apps',        labelKey: 'palette.item.goApps',      kind: 'navigation', icon: AppWindow,    to: '/apps',        weight: 10 },
    { id: 'nav.collab',      labelKey: 'palette.item.goCollab',    kind: 'navigation', icon: Users,        to: '/collaboration', weight: 10 },
    { id: 'nav.dictation',   labelKey: 'palette.item.goDictation', kind: 'navigation', icon: Mic,          to: '/dictation',   weight: 10 },
    { id: 'nav.mobile',      labelKey: 'palette.item.goMobile',    kind: 'navigation', icon: Smartphone,   to: '/mobile',      weight: 10 },
    { id: 'nav.design',      labelKey: 'palette.item.goDesign',    kind: 'navigation', icon: Layers,      to: '/design-system', weight: 10 },
    // v1.x P1：补齐此前只能手输 URL 到达的视图（simple 模式下「更多」浮层同样可达）。
    { id: 'nav.search',      labelKey: 'palette.item.goSearch',    kind: 'navigation', icon: Search,      to: '/search',        weight: 10 },
    { id: 'nav.memory',      labelKey: 'palette.item.goMemory',    kind: 'navigation', icon: Brain,       to: '/memory',        weight: 10 },
    { id: 'nav.tasks',       labelKey: 'palette.item.goTasks',     kind: 'navigation', icon: FolderKanban, to: '/tasks',        weight: 10 },
    { id: 'nav.schedule',    labelKey: 'palette.item.goSchedule',  kind: 'navigation', icon: Clock,       to: '/schedule',      weight: 10 },
    { id: 'nav.agents',      labelKey: 'palette.item.goAgents',    kind: 'navigation', icon: Bot,         to: '/agents',        weight: 10 },
    { id: 'nav.sideChannels', labelKey: 'palette.item.goSideChannels', kind: 'navigation', icon: Workflow, to: '/side-channels', weight: 10 },
    { id: 'nav.remote',      labelKey: 'palette.item.goRemote',    kind: 'navigation', icon: Wifi,        to: '/remote',        weight: 10 },
    { id: 'nav.kms',         labelKey: 'palette.item.goKms',       kind: 'navigation', icon: BookOpen,    to: '/kms',           weight: 10 },
    { id: 'nav.autopilot',   labelKey: 'palette.item.goAutopilot', kind: 'navigation', icon: Zap,         to: '/autopilot',     weight: 10 },
    { id: 'nav.squad',       labelKey: 'palette.item.goSquad',     kind: 'navigation', icon: Users,       to: '/squad',         weight: 10 },
    { id: 'nav.media',       labelKey: 'palette.item.goMedia',     kind: 'navigation', icon: ImageIcon,   to: '/media',         weight: 10 },

    // ---- Session actions ----
    { id: 'sess.new',    labelKey: 'palette.item.newSession',    hintKey: 'palette.item.newSessionHint',   kind: 'session', icon: Plus,    run: newSession, weight: 5 },
    { id: 'sess.clear',  labelKey: 'palette.item.clearSessions', hintKey: 'palette.item.clearSessionsHint', kind: 'session', icon: Trash2,  run: clearAllSessions, weight: 5 },
    { id: 'sess.export', labelKey: 'palette.item.exportActive',  hintKey: 'palette.item.exportActiveHint', kind: 'session', icon: Download, run: exportActive, weight: 5 },
    { id: 'sess.exportMarkdown', labelKey: 'palette.item.exportActiveMarkdown', hintKey: 'palette.item.exportActiveMarkdownHint', kind: 'session', icon: FileText, run: exportActiveMarkdown, weight: 5 },
    { id: 'cfg.save',    labelKey: 'palette.item.saveConfig',    hintKey: 'palette.item.saveConfigHint',   kind: 'system',  icon: Save,    run: saveConfig, weight: 5 },

    // ---- Slash actions ----
    { id: 'slash.compact',   labelKey: 'palette.item.runCompact',     slash: '/compact',   kind: 'slash', icon: RefreshCw, keywords: ['compress', 'summarize'], weight: 4 },
    { id: 'slash.interrupt', labelKey: 'palette.item.runInterrupt',   slash: '/interrupt', kind: 'slash', icon: RefreshCw, keywords: ['stop', 'cancel'], weight: 4 },
    { id: 'slash.clear',     labelKey: 'palette.item.runClear',       slash: '/clear',     kind: 'slash', icon: Trash2,    weight: 4 },
    { id: 'slash.help',      labelKey: 'palette.item.runHelp',        slash: '/help',      kind: 'slash', icon: BookOpen,  weight: 4 },
    { id: 'slash.rename',    labelKey: 'palette.item.runRename',      slash: '/rename ',   kind: 'slash', icon: Wrench,    keywords: ['title', 'label'], weight: 4 },
    { id: 'slash.export',    labelKey: 'palette.item.runExport',      slash: '/export',    kind: 'slash', icon: Download,  weight: 4 },
    { id: 'slash.new',       labelKey: 'palette.item.runNewSession',  slash: '/new',       kind: 'slash', icon: Plus,      weight: 4 },
    // v1.6.1:提示词层(/prompt)与模型级用量(/usage)—— 与 slash 引擎同源。
    { id: 'slash.prompt',    labelKey: 'palette.item.runPrompt',      slash: '/prompt',    kind: 'slash', icon: Layers,    keywords: ['prompt', 'layer', '提示词'], weight: 4 },
    { id: 'slash.usage',     labelKey: 'palette.item.runUsage',       slash: '/usage',     kind: 'slash', icon: Gauge,      keywords: ['tokens', 'cost', 'stats', '用量'], weight: 4 },

    // ---- Theme ----
    { id: 'theme.cycle',     labelKey: 'palette.item.toggleTheme',    kind: 'theme', icon: Palette, run: cycleTheme, weight: 3 },
    { id: 'theme.dark',      labelKey: 'palette.item.setThemeDark',   kind: 'theme', icon: Moon,    run: () => setTheme('dark'), weight: 3 },
    { id: 'theme.light',     labelKey: 'palette.item.setThemeLight',  kind: 'theme', icon: Sun,     run: () => setTheme('light'), weight: 3 },
    { id: 'theme.system',    labelKey: 'palette.item.setThemeSystem', kind: 'theme', icon: Monitor, run: () => setTheme('system'), weight: 3 },
    { id: 'theme.now',       labelKey: 'palette.item.themeCurrent',   kind: 'theme', icon: resolvedTheme === 'dark' ? Moon : Sun, run: cycleTheme, weight: 9 },
  ];
}
