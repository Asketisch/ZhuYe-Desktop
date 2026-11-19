/**
 * ChatHero —— 首页工作台的英雄区（新对话空态，v3 harness 设计）。
 *
 * 欢迎态 = 像素吉祥物 + 时段问候 + 工作区副标题；背景为吉祥物轮廓的
 * 大尺寸线稿水印。快捷模板 chips（QuickPromptRow）由 ChatView 渲染在
 * Composer 下方，点击经 emitComposerPrefill 预填（不自动发送）。
 */
import { useMemo } from 'react';
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { emitComposerPrefill } from '@/features/composer/useComposerDraft';
import { Icon } from '@/features/design-system';
import { Compass, Hammer, ScanSearch, Bug } from 'lucide-react';
import { QUICK_PROMPTS, type QuickPrompt } from './quickPrompts';
import s from '@/render/home/ChatHero.module.css';

const icons = { explore: Compass, build: Hammer, review: ScanSearch, fix: Bug };

/* 像素吉祥物（16×16 字符网格，'#' = 实心像素）—— 与设计稿逐格一致。 */
const MASCOT = [
  '................',
  '................',
  '.....######.....',
  '...##########...',
  '..############..',
  '.##############.',
  '.####.####.####.',
  '.####.####.####.',
  '.##############.',
  '.##############.',
  '..############..',
  '...##########...',
  '.....######.....',
  '................',
  '................',
  '................',
];

/** 轮廓提取：仅保留相邻存在透明格的像素（线稿而非实心剪影）。 */
function outlineOf(map: string[]): string[] {
  const h = map.length;
  const w = map[0].length;
  return map.map((row, y) => row.split('').map((ch, x) => {
    if (ch !== '#') return '.';
    const hasTransparent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const ny = y + dy;
      const nx = x + dx;
      return ny < 0 || nx < 0 || ny >= h || nx >= w || map[ny][nx] !== '#';
    });
    return hasTransparent ? '#' : '.';
  }).join(''));
}

/** 像素网格 → div 网格（每格一格，无缝）。 */
function PixelArt({ map, cell, className, testid }: {
  map: string[];
  cell: number;
  className?: string;
  testid?: string;
}) {
  const cells = useMemo(() => map.flatMap((row) => row.split('')), [map]);
  return (
    <div
      className={className ?? 'pixel-art'}
      data-testid={testid}
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${map[0].length}, ${cell}px)`,
        gridTemplateRows: `repeat(${map.length}, ${cell}px)`,
      }}
    >
      {cells.map((ch, i) => (
        <i key={i} style={{ width: cell, height: cell, background: ch === '#' ? 'currentColor' : 'transparent' }} />
      ))}
    </div>
  );
}

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
  const watermark = useMemo(() => outlineOf(MASCOT), []);

  return (
    <div className={s.hero}>
      {/* 吉祥物轮廓水印：绝对定位铺在英雄区背后，不拦截指针。 */}
      <div className={s.watermark} aria-hidden="true">
        <PixelArt map={watermark} cell={26} />
      </div>
      <div className={s.mascot} aria-hidden="true">
        <PixelArt map={MASCOT} cell={4} testid="chat-hero-mascot" />
      </div>
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
