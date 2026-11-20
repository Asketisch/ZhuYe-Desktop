/**
 * quickPrompts —— 首页 Hero 的快捷 prompt 模板（纯静态数据 + i18n key）。
 *
 * 首页四张任务建议卡：点击只**预填** composer 草稿
 * （走 emitComposerPrefill），不自动发送 —— 用户保留审阅与补充的机会。
 * 全部为通用任务型模板，不依赖特定工作区；后续可按工作区语言/结构动态生成。
 */
import type { LocaleKey } from '@/utils/i18n';

export interface QuickPrompt {
  id: 'explore' | 'build' | 'review' | 'fix';
  titleKey: LocaleKey;
  promptKey: LocaleKey;
}

export const QUICK_PROMPTS: readonly QuickPrompt[] = [
  { id: 'explore', titleKey: 'chat.quick.explore.title', promptKey: 'chat.quick.explore.prompt' },
  { id: 'build', titleKey: 'chat.quick.build.title', promptKey: 'chat.quick.build.prompt' },
  { id: 'review', titleKey: 'chat.quick.review.title', promptKey: 'chat.quick.review.prompt' },
  { id: 'fix', titleKey: 'chat.quick.fix.title', promptKey: 'chat.quick.fix.prompt' },
] as const;
