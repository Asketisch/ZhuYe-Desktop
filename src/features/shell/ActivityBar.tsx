/**
 * ActivityBar —— IDE 风左侧竖条导航。
 *
 * v1.x 双模式（uiPrefs.activityBarMode）：
 * - `simple`（默认，面向大众）：只保留 Chat / Search 高频入口 + 「更多」
 *   分组浮层 + Settings。高级视图（Git/Terminal/Automation/…）收进浮层，
 *   不再默认占据整栏 —— 17 个平铺图标对非程序员用户过于硬核。
 * - `full`（开发者模式，Settings → Display 开启）：全部视图平铺（历史行为）。
 *
 * 两种模式下 ⌘K 命令面板始终可达全部视图（兜底可发现性）。
 * active 态从当前 location 派生。
 */
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, FolderGit2, Wrench, GitBranch, Bell, Settings, Info, Terminal, Home, FolderKanban, Clock, Bot, Workflow, Wifi, Mic, BookOpen, Zap, Users, Image, Search, Ellipsis, GitPullRequestArrow, Webhook, Activity, Gauge } from 'lucide-react';
import type { ComponentType } from 'react';
import { useRouter, useLocation } from '@tanstack/react-router';
import { Icon, IconButton, Tooltip } from '@/features/design-system';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import { useUiPrefs } from '@/utils/uiPrefs';
import s from './ActivityBar.module.css';

interface NavItem {
  to: string;
  labelKey: LocaleKey;
  icon: ComponentType;
  /** 路由前缀匹配（用于 active 判定，如 /chat 匹配 /chat/$id）。 */
  matchPrefix?: string;
}

/** full 模式的历史平铺列表（保持原顺序）。 */
const PRIMARY: NavItem[] = [
  { to: '/home', labelKey: 'shell.nav.home', icon: Home },
  { to: '/', labelKey: 'shell.nav.chat', icon: MessageSquare, matchPrefix: '/chat' },
  { to: '/files', labelKey: 'shell.nav.files', icon: FolderGit2 },
  { to: '/git', labelKey: 'shell.nav.git', icon: GitBranch },
  { to: '/terminal', labelKey: 'shell.nav.terminal', icon: Terminal },
  { to: '/skills', labelKey: 'shell.nav.skills', icon: Wrench },
  { to: '/notifications', labelKey: 'shell.nav.notifications', icon: Bell },
  { to: '/tasks', labelKey: 'shell.nav.tasks', icon: FolderKanban },
  { to: '/schedule', labelKey: 'shell.nav.schedule', icon: Clock },
  { to: '/agents', labelKey: 'shell.nav.agents', icon: Bot },
  { to: '/side-channels', labelKey: 'shell.nav.sideChannels', icon: Workflow },
  { to: '/remote', labelKey: 'shell.nav.remote', icon: Wifi },
  { to: '/dictation', labelKey: 'shell.nav.dictation', icon: Mic },
  { to: '/kms', labelKey: 'shell.nav.kms', icon: BookOpen },
  { to: '/autopilot', labelKey: 'shell.nav.autopilot', icon: Zap },
  { to: '/squad', labelKey: 'shell.nav.squad', icon: Users },
  { to: '/media', labelKey: 'shell.nav.media', icon: Image },
  { to: '/traces', labelKey: 'shell.nav.traces', icon: Activity },
  { to: '/usage', labelKey: 'shell.nav.usage', icon: Gauge },
];

const SECONDARY: NavItem[] = [
  { to: '/settings', labelKey: 'shell.nav.settings', icon: Settings },
  { to: '/about', labelKey: 'shell.nav.about', icon: Info },
];

/** simple 模式高频入口：新会话 + 全局搜索。 */
const SIMPLE_PRIMARY: NavItem[] = [
  { to: '/', labelKey: 'shell.nav.chat', icon: MessageSquare, matchPrefix: '/chat' },
  { to: '/search', labelKey: 'shell.nav.search', icon: Search },
];

/** 「更多」浮层 —— 按场景分三组收纳其余全部视图。 */
const MORE_GROUPS: { titleKey: LocaleKey; items: NavItem[] }[] = [
  {
    titleKey: 'shell.more.devTools',
    items: [
      { to: '/files', labelKey: 'shell.nav.files', icon: FolderGit2 },
      { to: '/git', labelKey: 'shell.nav.git', icon: GitBranch },
      { to: '/pulls', labelKey: 'shell.nav.pulls', icon: GitPullRequestArrow },
      { to: '/terminal', labelKey: 'shell.nav.terminal', icon: Terminal },
      { to: '/skills', labelKey: 'shell.nav.skills', icon: Wrench },
      { to: '/hooks', labelKey: 'shell.nav.hooks', icon: Webhook },
      { to: '/traces', labelKey: 'shell.nav.traces', icon: Activity },
      { to: '/usage', labelKey: 'shell.nav.usage', icon: Gauge },
    ],
  },
  {
    titleKey: 'shell.more.automation',
    items: [
      { to: '/tasks', labelKey: 'shell.nav.tasks', icon: FolderKanban },
      { to: '/schedule', labelKey: 'shell.nav.schedule', icon: Clock },
      { to: '/autopilot', labelKey: 'shell.nav.autopilot', icon: Zap },
      { to: '/agents', labelKey: 'shell.nav.agents', icon: Bot },
      { to: '/squad', labelKey: 'shell.nav.squad', icon: Users },
    ],
  },
  {
    titleKey: 'shell.more.features',
    items: [
      { to: '/notifications', labelKey: 'shell.nav.notifications', icon: Bell },
      { to: '/dictation', labelKey: 'shell.nav.dictation', icon: Mic },
      { to: '/remote', labelKey: 'shell.nav.remote', icon: Wifi },
      { to: '/kms', labelKey: 'shell.nav.kms', icon: BookOpen },
      { to: '/media', labelKey: 'shell.nav.media', icon: Image },
      { to: '/side-channels', labelKey: 'shell.nav.sideChannels', icon: Workflow },
      { to: '/home', labelKey: 'shell.nav.home', icon: Home },
      { to: '/about', labelKey: 'shell.nav.about', icon: Info },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.to === '/') {
    // index 路由：仅正好根路径或 /chat/$id 时 active。
    return pathname === '/' || pathname === '/chat' || pathname.startsWith('/chat/');
  }
  const prefix = item.matchPrefix ?? item.to;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** 「更多」浮层 —— 列出 simple 模式未平铺的全部视图。 */
function MoreFlyout({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { t } = useI18n();
  return (
    <div className={s.flyout} role="menu" aria-label={t('shell.more.title')} data-testid="activitybar-more-flyout">
      <div className={s.flyoutTitle}>{t('shell.more.title')}</div>
      {MORE_GROUPS.map((group) => (
        <div key={group.titleKey} className={s.flyoutGroup}>
          <div className={s.flyoutGroupTitle}>{t(group.titleKey)}</div>
          {group.items.map((item) => (
            <button
              key={item.to}
              type="button"
              role="menuitem"
              className={s.flyoutItem}
              onClick={() => onNavigate(item.to)}
            >
              <Icon icon={item.icon} size={14} />
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ActivityBar() {
  const router = useRouter();
  const location = useLocation();
  const pathname = location.pathname;
  const { t } = useI18n();
  const [prefs] = useUiPrefs();
  const simple = prefs.activityBarMode !== 'full';
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  // 浮层外点击 / Esc 关闭。
  useEffect(() => {
    if (!moreOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!moreWrapRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const navigate = (to: string) => {
    setMoreOpen(false);
    void router.navigate({ to });
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item);
    const label = t(item.labelKey);
    return (
      <Tooltip key={item.to} label={label} side="right">
        <IconButton
          label={label}
          variant={active ? 'active' : 'default'}
          size="lg"
          aria-current={active ? 'page' : undefined}
          onClick={() => navigate(item.to)}
        >
          <Icon icon={item.icon} size={18} />
        </IconButton>
      </Tooltip>
    );
  };

  return (
    <nav className={s.bar} aria-label={t('shell.activityBar')} data-mode={simple ? 'simple' : 'full'}>
      <div className={s.logo} aria-hidden="true" title={t('shell.logoTitle')}>
        R
      </div>
      {simple ? (
        <>
          <div className={`${s.group} ${s.groupPrimary}`}>
            {SIMPLE_PRIMARY.map(renderItem)}
            <div className={s.moreWrap} ref={moreWrapRef}>
              <Tooltip label={t('shell.nav.more')} side="right">
                <IconButton
                  label={t('shell.nav.more')}
                  variant={moreOpen ? 'active' : 'default'}
                  size="lg"
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  onClick={() => setMoreOpen((open) => !open)}
                  data-testid="activitybar-more"
                >
                  <Icon icon={Ellipsis} size={18} />
                </IconButton>
              </Tooltip>
              {moreOpen && <MoreFlyout onNavigate={navigate} />}
            </div>
          </div>
          <div className={s.group}>{SECONDARY.filter((item) => item.to === '/settings').map(renderItem)}</div>
        </>
      ) : (
        <>
          <div className={`${s.group} ${s.groupPrimary}`}>
            {PRIMARY.map(renderItem)}
          </div>
          <div className={s.group}>
            {SECONDARY.map(renderItem)}
          </div>
        </>
      )}
    </nav>
  );
}
