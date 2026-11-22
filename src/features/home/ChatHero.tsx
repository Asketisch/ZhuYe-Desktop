/**
 * ChatHero —— 首页工作台的英雄区（新对话空态，v3 harness 设计）。
 *
 * 欢迎态 = 「火中生羽」像素徽记（ZhuyeEmblem）+ 时段问候 + 工作区副标题。
 * 快捷模板 chips（QuickPromptRow）由 ChatView 渲染在 Composer 下方，
 * 点击经 emitComposerPrefill 预填（不自动发送）。
 */
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { emitComposerPrefill } from '@/features/composer/useComposerDraft';
import { Icon } from '@/features/design-system';
import { Compass, Hammer, ScanSearch, Bug } from 'lucide-react';
import { QUICK_PROMPTS, type QuickPrompt } from './quickPrompts';
import { ZhuyeEmblem } from './ZhuyeEmblem';
import s from '@/render/home/ChatHero.module.css';

const icons = { explore: Compass, build: Hammer, review: ScanSearch, fix: Bug };

type GreetingKey = 'chat.greeting.morning' | 'chat.greeting.afternoon' | 'chat.greeting.evening';

function greetingKeyFor(hour: number): GreetingKey {
  if (hour < 12) return 'chat.greeting.morning';
  if (hour < 18) return 'chat.greeting.afternoon';
  return 'chat.greeting.evening';
}

export function ChatHero() {
  const { t } = useI18n();
  const { currentWorkspace } = useCurrentWorkspace();
  const greetingKey = greetingKeyFor(new Date().getHours());
  const workspaceName = currentWorkspace
    ? currentWorkspace.split('/').filter(Boolean).pop()
    : null;

  return (
    <div className={s.hero}>
      <ZhuyeEmblem />
      <h1 className={s.title} data-testid="chat-hero-greeting">{t(greetingKey)}</h1>
      <p className={s.subtitle}>{t('chat.greeting.subtitle')}</p>
      {workspaceName && (
        <p className={s.workspace} data-testid="chat-hero-workspace">
          {t('chat.hero.workspace', { name: workspaceName })}
        </p>
      )}
    </div>
  );
}

/** 快捷模板 chips —— 渲染在 Composer 下方，点击预填不发送。 */
export function QuickPromptRow() {
  const { t } = useI18n();
  return (
    <div className={s.quickRow} role="group" aria-label={t('chat.quick.title')}>
      {QUICK_PROMPTS.map((prompt) => (
        <QuickChip key={prompt.id} prompt={prompt} />
      ))}
    </div>
  );
}

function QuickChip({ prompt }: { prompt: QuickPrompt }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={s.quickChip}
      onClick={() => emitComposerPrefill(t(prompt.promptKey))}
      data-testid={`quick-prompt-${prompt.id}`}
    >
      <Icon icon={icons[prompt.id]} size={13} />
      <span>{t(prompt.titleKey)}</span>
    </button>
  );
}
