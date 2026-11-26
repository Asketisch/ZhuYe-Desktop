/**
 * ChatHero —— 首页工作台的英雄区（新对话空态，v3 harness 设计）。
 *
 * 欢迎态 = 「火中生羽」像素徽记（ZhuyeEmblem）+ 时段问候 + 工作区副标题。
 *
 * v1.13:原挂在 Hero 下方的快捷模板 chips（QuickPromptRow）已移除 ——
 * 四个通用任务模板统一收进「+」菜单的「建议」二级目录,避免同一批模板
 * 散落在首页与会话内两处。
 */
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { isPlaceholderWorkspace } from '@/logic/sessions/workspaceGroups';
import { ZhuyeEmblem } from './ZhuyeEmblem';
import s from '@/render/home/ChatHero.module.css';

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
  // 占位工作区(cwd 解析失败的「.」等)显示「默认」,不裸显目录符号。
  const workspaceName = !currentWorkspace
    ? null
    : isPlaceholderWorkspace(currentWorkspace)
      ? t('common.workspaceDefault')
      : (currentWorkspace.split('/').filter(Boolean).pop() ?? null);

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
