import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search } from 'lucide-react';
import type { TitleBarProps } from '@/contracts/titleBar';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { Tooltip } from '../design-system/Tooltip';
import { Badge } from '../design-system/Badge';
import s from './TitleBar.module.css';

/** 路径 → i18n key 映射。统一通过 t(key) 渲染。 */
const TITLES: Record<string, string> = {
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

function titleFor(pathname: string, t: TitleBarProps['t']): string {
  const key = TITLES[pathname];
  if (key) return t(key);
  if (pathname.startsWith('/chat')) return t('shell.title.chat');
  return t('shell.title.reflect');
}

export function TitleBar({ t, pathname, sessionLabel, permissionMode, sidebarOpen, inspectorOpen,
  onToggleSidebar, onToggleInspector }: TitleBarProps) {
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
        <h1 className={s.title}>{titleFor(pathname, t)}</h1>
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
