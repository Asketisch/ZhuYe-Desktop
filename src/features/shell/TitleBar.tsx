/**
 * TitleBar —— 贯通全宽的顶栏（macOS Overlay 标题栏）。
 *
 * 关键设计：
 *   - 根元素挂 `data-tauri-drag-region="deep"` —— 整条顶栏（含标题文本等
 *     子树）可拖动窗口。Tauri 的 drag.js 会自动豁免 button/a/input 等可
 *     点击元素，toggle 按钮不受影响。
 *   - 拖拽生效依赖 capabilities 的 `core:window:allow-start-dragging` 权限
 *     （`core:window:default` 只含只读 getter，不含该命令 —— 缺权限时
 *     `start_dragging` IPC 被 ACL 拒绝，窗口拖不动）。
 *   - 高度 = `--titlebar-height` token（40px，macOS 标准）。
 *   - 左侧 `--traffic-light-gutter` (80px) padding 为红绿灯按钮让位。
 *   - 内容：sidebar toggle + 当前 view 标题 + session 状态 / 右侧 permission + inspector toggle。
 *
 * **session 状态文案**：保留 `session: (waiting…)` 字面契约（测试断言依赖），
 * 但在 `session_configured` 事件未到时，从 `reflect_agent_status` 查询拿 model 名，
 * 避免开局永远显示「waiting」。
 */
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Icon, IconButton, Tooltip, Badge } from '@/features/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_agent_status } from '@/utils/commands';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import { isUsableModelSpec } from './modelLabel';
import s from './TitleBar.module.css';

/** 路径 → i18n key 映射。统一通过 t(key) 渲染。 */
const TITLES: Record<string, LocaleKey> = {
  '/': 'shell.title.chat',
  '/home': 'shell.title.home',
  '/chat': 'shell.title.chat',
  '/sessions': 'shell.title.threads',
  '/files': 'shell.title.files',
  '/git': 'shell.title.git',
  '/terminal': 'shell.title.terminal',
  '/skills': 'shell.title.skills',
  '/workspaces': 'shell.title.workspaces',
  '/models': 'shell.title.models',
  '/plan': 'shell.title.plan',
  '/prompts': 'shell.title.prompts',
  '/notifications': 'shell.title.notifications',
  '/settings': 'shell.title.settings',
  '/about': 'shell.title.about',
  '/debug': 'shell.title.debug',
  '/apps': 'shell.title.apps',
  '/import': 'shell.title.import',
  '/preview': 'shell.title.preview',
  '/collaboration': 'shell.title.collaboration',
  '/mobile': 'shell.title.mobile',
  '/dictation': 'shell.title.dictation',
  '/design-system': 'shell.title.designSystem',
  '/memory': 'shell.title.memory',
  '/search': 'shell.title.search',
  '/tasks': 'shell.title.tasks',
  '/schedule': 'shell.title.schedule',
  '/agents': 'shell.title.agents',
  '/side-channels': 'shell.title.sideChannels',
  '/remote': 'shell.title.remote',
  '/kms': 'shell.title.kms',
  '/autopilot': 'shell.title.autopilot',
  '/squad': 'shell.title.squad',
  '/media': 'shell.title.media',
};

function titleFor(pathname: string, t: (key: LocaleKey) => string): string {
  const key = TITLES[pathname];
  if (key) return t(key);
  if (pathname.startsWith('/chat')) return t('shell.title.chat');
  return t('shell.title.reflect');
}

export function TitleBar({
  sidebarOpen,
  onToggleSidebar,
  inspectorOpen,
  onToggleInspector,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const location = useLocation();
  const session = useAgentStore((s) => s.session);
  const permissionMode = useAgentStore((s) => s.permissionMode);
  const { t } = useI18n();

  // 后端诊断查询 —— session_configured 事件未到时的 fallback。
  const statusQ = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });

  // session 里的 "stub/test" 占位(无 provider/model 的降级线程)不算可用,
  // 与 StatusBar 同规则落到 has_model / 会话等待文案。
  const sessionLabel =
    session && isUsableModelSpec(session.model)
      ? `${session.model} @ ${session.provider}`
      : statusQ.data?.has_model
        ? statusQ.data.model
        : t('shell.sessionWaiting');

  return (
    // data-tauri-drag-region="deep"：子树内任意非交互元素命中都触发拖动；
    // drag.js 自动跳过 button/a/input（isClickableElement），toggle 仍可点击，
    // 并在命中时自行 preventDefault 防止文本选中抢焦点。
    <header
      className={s.bar}
      data-tauri-drag-region="deep"
      data-testid="titlebar"
    >
      <div className={s.left}>
        <Tooltip label={sidebarOpen ? t('shell.hideSidebar') : t('shell.showSidebar')} side="bottom">
          <IconButton label={sidebarOpen ? t('shell.hideSidebar') : t('shell.showSidebar')} onClick={onToggleSidebar}>
            <Icon icon={sidebarOpen ? PanelLeftClose : PanelLeftOpen} size={16} />
          </IconButton>
        </Tooltip>
        <h1 className={s.title}>{titleFor(location.pathname, t)}</h1>
        {/* session 状态（保留 "session: ..." 文案契约，供 MessageList 测试断言） */}
        <span className={s.sessionStatus} data-testid="titlebar-session">
          {t('shell.sessionLabel', { label: sessionLabel })}
        </span>
      </div>
      <div className={s.right}>
        <Tooltip label={t('shell.commandPaletteHint')} side="bottom">
          <kbd className={s.kbdHint}>
            <Icon icon={Search} size={11} /> ⌘K
          </kbd>
        </Tooltip>
        {permissionMode && (
          <Badge variant={permissionMode === 'auto' ? 'success' : permissionMode === 'plan' ? 'info' : 'warning'}>
            {t(`permissionMode.${permissionMode}.name`)}
          </Badge>
        )}
        <Tooltip label={inspectorOpen ? t('shell.hideInspector') : t('shell.showInspector')} side="bottom">
          <IconButton label={inspectorOpen ? t('shell.hideInspector') : t('shell.showInspector')} onClick={onToggleInspector} variant={inspectorOpen ? 'active' : 'default'}>
            <Icon icon={inspectorOpen ? PanelRightClose : PanelRightOpen} size={16} />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
