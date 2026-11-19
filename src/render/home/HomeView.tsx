import { MessageSquarePlus, FolderOpen, Settings as SettingsIcon, Cpu, MessageSquare, ArrowRight } from 'lucide-react';
import type { ComponentType } from 'react';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { Button } from '../design-system/Button';
import { EmptyState } from '../design-system/EmptyState';
import type { HomeViewProps } from '@/contracts/home';
import s from './HomeView.module.css';

interface QuickAction {
  to: string;
  label: string;
  desc: string;
  icon: ComponentType;
}

export function HomeView({ recent, activeModel, onOpen, onOpenSession, t, relative }: HomeViewProps) {
  const ACTIONS: QuickAction[] = [
    { to: '/chat', label: t('sidebar.newChat'), desc: t('home.startNew'), icon: MessageSquarePlus },
    { to: '/workspaces', label: t('shell.nav.workspaces'), desc: t('home.openRecent'), icon: FolderOpen },
    { to: '/models', label: t('shell.nav.models'), desc: t('home.shortcut.newSession'), icon: Cpu },
    { to: '/settings', label: t('shell.nav.settings'), desc: t('settings.title'), icon: SettingsIcon },
  ];
  return (
    <div className={s.root}>
      <header className={s.hero}>
        <div className={s.brand}>
          <div className={s.logo}>Z</div>
          <div><h1 className={s.title}>{t('home.title')}</h1><p className={s.subtitle}>{t('home.subtitle')}</p></div>
        </div>
        {activeModel && <Card level="outlined" padding="sm" className={s.statusCard}><div className={s.statusRow}><Badge variant="success" dot>{t('home.active')}</Badge><code className={s.statusModel}>{activeModel.model}</code><span className={s.statusProvider}>@ {activeModel.provider}</span></div></Card>}
      </header>
      <section>
        <h2 className={s.sectionTitle}>{t('home.quickStart')}</h2>
        <div className={s.actionGrid}>{ACTIONS.map((a) => (
          <button key={a.to} className={s.actionCard} onClick={() => onOpen(a.to)}>
            <div className={s.actionIcon}><Icon icon={a.icon} size={20} /></div>
            <div className={s.actionBody}><div className={s.actionLabel}>{a.label}</div><div className={s.actionDesc}>{a.desc}</div></div>
            <Icon icon={ArrowRight} size={14} className={s.actionArrow} />
          </button>
        ))}</div>
      </section>
      <section>
        <div className={s.sectionHeader}><h2 className={s.sectionTitle}>{t('home.recentSessions')}</h2><Button variant="ghost" size="sm" onClick={() => onOpen('/sessions')}>{t('home.viewAll')}</Button></div>
        {recent.length === 0 ? (
          <Card level="flat" padding="none"><EmptyState icon={<Icon icon={MessageSquare} />} title={t('home.noRecent')} description={t('home.startNew')} action={<Button variant="primary" size="sm" leftIcon={<Icon icon={MessageSquarePlus} size={14} />} onClick={() => onOpen('/chat')}>{t('sidebar.newChat')}</Button>} /></Card>
        ) : (
          <div className={s.recentList}>{recent.map((sess) => (
            <button key={sess.id} className={s.recentItem} onClick={() => onOpenSession(sess.id)}>
              <Icon icon={MessageSquare} size={14} className={s.recentIcon} />
              <div className={s.recentBody}><div className={s.recentLabel}>{sess.label}</div><div className={s.recentMeta}>{relative(sess.startedAt)} · {sess.messages} msgs</div></div>
              <Icon icon={ArrowRight} size={12} className={s.actionArrow} />
            </button>
          ))}</div>
        )}
      </section>
    </div>
  );
}
