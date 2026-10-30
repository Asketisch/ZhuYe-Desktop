/**
 * Home —— 欢迎仪表盘（CSS Modules 版）。
 *
 * - 顶部欢迎区 + 当前 model/workspace 状态卡
 * - 快速操作: 4 个大卡片（New Chat / Workspaces / Settings / Models）
 * - Recent Sessions 卡片列表
 */
import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquarePlus, FolderOpen, Settings as SettingsIcon, Cpu, MessageSquare, ArrowRight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useSessions } from '@/features/sessions/hooks/useSessions';
import { useAgent } from '@/services/agent';
import { Card, Badge, Icon, Button, EmptyState } from '@/features/design-system';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import { relativeTime } from '@/utils/time';
import s from './HomeView.module.css';

interface QuickAction {
  to: string;
  labelKey: LocaleKey;
  descKey: LocaleKey;
  icon: ComponentType;
}

const ACTIONS: QuickAction[] = [
  { to: '/chat', labelKey: 'sidebar.newChat', descKey: 'home.startNew', icon: MessageSquarePlus },
  { to: '/workspaces', labelKey: 'shell.nav.workspaces', descKey: 'home.openRecent', icon: FolderOpen },
  { to: '/models', labelKey: 'shell.nav.models', descKey: 'home.shortcut.newSession', icon: Cpu },
  { to: '/settings', labelKey: 'shell.nav.settings', descKey: 'settings.title', icon: SettingsIcon },
];

export function HomeView() {
  const { buckets } = useSessions();
  const { session } = useAgent();
  const navigate = useNavigate();
  const { t } = useI18n();

  const recent = useMemo(() => {
    // 标签 = 会话标题（自定义名 / AI 标题 / 派生值，由后端精化）；
    // 无标题的空会话回退 id 前缀。token 通过 card meta 展示。
    const all: Array<{ id: string; label: string; started_at: string; messages: number }> = [];
    for (const b of buckets) {
      for (const sess of b.sessions) {
        all.push({
          id: sess.session_id,
          label: sess.title || sess.session_id.slice(0, 8),
          started_at: sess.started_at,
          messages: sess.message_count,
        });
      }
    }
    all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return all.slice(0, 6);
  }, [buckets]);

  return (
    <div className={s.root}>
      <header className={s.hero}>
        <div className={s.brand}>
          <div className={s.logo}>Z</div>
          <div>
            <h1 className={s.title}>{t('home.title')}</h1>
            <p className={s.subtitle}>
              {t('home.subtitle')}
            </p>
          </div>
        </div>
        {session && (
          <Card level="outlined" padding="sm" className={s.statusCard}>
            <div className={s.statusRow}>
              <Badge variant="success" dot>{t('home.active')}</Badge>
              <code className={s.statusModel}>{session.model}</code>
              <span className={s.statusProvider}>@ {session.provider}</span>
            </div>
          </Card>
        )}
      </header>

      <section>
        <h2 className={s.sectionTitle}>{t('home.quickStart')}</h2>
        <div className={s.actionGrid}>
          {ACTIONS.map((a) => (
            <button
              key={a.to}
              className={s.actionCard}
              onClick={() => navigate({ to: a.to })}
            >
              <div className={s.actionIcon}>
                <Icon icon={a.icon} size={20} />
              </div>
              <div className={s.actionBody}>
                <div className={s.actionLabel}>{t(a.labelKey)}</div>
                <div className={s.actionDesc}>{t(a.descKey)}</div>
              </div>
              <Icon icon={ArrowRight} size={14} className={s.actionArrow} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className={s.sectionHeader}>
          <h2 className={s.sectionTitle}>{t('home.recentSessions')}</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/sessions' })}>
            {t('home.viewAll')}
          </Button>
        </div>
        {recent.length === 0 ? (
          <Card level="flat" padding="none">
            <EmptyState
              icon={<Icon icon={MessageSquare} />}
              title={t('home.noRecent')}
              description={t('home.startNew')}
              action={
                <Button variant="primary" size="sm" leftIcon={<Icon icon={MessageSquarePlus} size={14} />} onClick={() => navigate({ to: '/chat' })}>
                  {t('sidebar.newChat')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className={s.recentList}>
            {recent.map((sess) => (
              <button
                key={sess.id}
                className={s.recentItem}
                onClick={() => navigate({ to: '/chat/$sessionId', params: { sessionId: sess.id } })}
              >
                <Icon icon={MessageSquare} size={14} className={s.recentIcon} />
                <div className={s.recentBody}>
                  <div className={s.recentLabel}>{sess.label}</div>
                  <div className={s.recentMeta}>
                    {relativeTime(sess.started_at)} · {sess.messages} msgs
                  </div>
                </div>
                <Icon icon={ArrowRight} size={12} className={s.actionArrow} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
