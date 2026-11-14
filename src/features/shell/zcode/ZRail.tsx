/**
 * ZRail —— v2 重设计的 48px 窄 rail(redesign/zcode-shell)。
 *
 * 替代旧 ActivityBar 的双模式设计:高频入口直接平铺,其余全部视图收纳进
 * 「更多」popover(沿用 ActivityBar 的 MORE_GROUPS 分组)。非 chat 主工作台
 * 的路由仍由 TanStack Router 承载,rail 只是导航入口。
 */
import { useEffect, useRef, useState } from 'react';
import {
  MessageSquare, Search, FolderGit2, Terminal, FolderKanban, Zap, Bot, Users, Clock,
  Settings, Menu, Download, Bell, Mic, Wifi, BookOpen, Image as ImageIcon,
  Wrench, GitBranch, GitPullRequestArrow, Webhook, Activity, Gauge, Info, Home,
  Workflow, ChevronDown,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useRouter, useLocation } from '@tanstack/react-router';
import { useI18n } from '@/utils/i18n';
import s from './zcode.module.css';

interface NavItem {
  to: string;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
  icon: ComponentType;
  matchPrefix?: string;
}

const PRIMARY: NavItem[] = [
  { to: '/', labelKey: 'zcode.rail.chat', icon: MessageSquare, matchPrefix: '/chat' },
  { to: '/files', labelKey: 'zcode.rail.files', icon: FolderGit2 },
  { to: '/terminal', labelKey: 'zcode.rail.terminal', icon: Terminal },
  { to: '/tasks', labelKey: 'zcode.rail.tasks', icon: FolderKanban },
  { to: '/autopilot', labelKey: 'zcode.rail.autopilot', icon: Zap },
  { to: '/squad', labelKey: 'zcode.rail.squad', icon: Users },
];

/** 「更多」浮层 —— 沿用 ActivityBar 的三组收纳,保证全部视图可达。 */
const MORE_GROUPS: { titleKey: Parameters<ReturnType<typeof useI18n>['t']>[0]; items: NavItem[] }[] = [
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
      { to: '/search', labelKey: 'shell.nav.search', icon: Search },
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
      { to: '/media', labelKey: 'shell.nav.media', icon: ImageIcon },
      { to: '/side-channels', labelKey: 'shell.nav.sideChannels', icon: Workflow },
      { to: '/home', labelKey: 'shell.nav.home', icon: Home },
      { to: '/about', labelKey: 'shell.nav.about', icon: Info },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.to === '/') {
    return pathname === '/' || pathname === '/chat' || pathname.startsWith('/chat/');
  }
  const prefix = item.matchPrefix ?? item.to;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function ZRail({ onOpenUpdates }: { onOpenUpdates?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const go = (to: string) => {
    setMoreOpen(false);
    void router.navigate({ to });
  };
  const Icon = ({ ic: Ic }: { ic: ComponentType }) => <Ic />;

  return (
    <nav className={s.rail} aria-label={t('shell.activityBar')}>
      {PRIMARY.map((item) => {
        const Ic = item.icon;
        return (
          <button
            key={item.to}
            type="button"
            className={s.railBtn}
            data-active={isActive(pathname, item)}
            data-testid={`zrail-${item.to.replace(/\//g, '') || 'chat'}`}
            aria-label={t(item.labelKey)}
            title={t(item.labelKey)}
            onClick={() => go(item.to)}
          >
            <Icon ic={Ic} />
          </button>
        );
      })}
      <div ref={moreRef} style={{ position: 'relative', display: 'contents' }}>
        <button
          type="button"
          className={s.railBtn}
          data-active={moreOpen}
          aria-label={t('zcode.rail.more')}
          title={t('zcode.rail.more')}
          data-testid="zrail-more"
          aria-haspopup="menu"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <Menu />
        </button>
        {moreOpen && (
          <div
            className={`${s.pop} ${s.popRight}`}
            role="menu"
            aria-label={t('zcode.rail.more')}
            data-testid="activitybar-more-flyout"
            style={{ maxHeight: 480, overflowY: 'auto', top: 0, left: '100%' }}
          >
            {MORE_GROUPS.map((group) => (
              <div key={group.titleKey}>
                <div className={s.popHead}>{t(group.titleKey)}</div>
                {group.items.map((item) => {
                  const Ic = item.icon;
                  return (
                    <button key={item.to} type="button" role="menuitem" className={s.popRow} onClick={() => go(item.to)}>
                      <Ic />
                      {t(item.labelKey)}
                      {isActive(pathname, item) && <ChevronDown style={{ marginLeft: 'auto', opacity: 0.5 }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={s.railGrow} />
      <button
        type="button"
        className={s.railBtn}
        aria-label={t('zcode.rail.updates')}
        title={t('zcode.rail.updates')}
        onClick={onOpenUpdates}
      >
        <Download />
      </button>
      <button
        type="button"
        className={s.railBtn}
        data-active={pathname.startsWith('/settings')}
        aria-label={t('zcode.rail.settings')}
        title={t('zcode.rail.settings')}
        data-testid="zrail-settings"
        onClick={() => go('/settings')}
      >
        <Settings />
      </button>
    </nav>
  );
}
