/**
 * quickPrompts —— 「+」菜单「建议」二级目录的数据（纯静态数据 + i18n key）。
 *
 * v1.13:四个通用任务模板（探索并理解代码 / 构建新功能 / 审查代码改动 /
 * 修复问题）原先渲染在首页 Hero chips 与会话内「建议」弹层,现只保留在
 * 「+」菜单的二级目录里 —— 一处入口,避免同一批模板散落三处。
 *
 * 分组:四项按「先读懂 → 再动手」的节奏分两组,二级目录里先渲染组标题
 * 再渲染组内条目 —— 让用户按阶段扫,而不是平铺四条无层级条目。
 *
 * 点击语义不变:只**预填** composer 草稿（走 `emitComposerPrefill`）,
 * 不自动发送 —— 用户保留审阅与补充的机会。
 */
import type { LocaleKey } from '@/utils/i18n';

export interface QuickPrompt {
  id: 'explore' | 'build' | 'review' | 'fix';
  /** 所属分组的 id（见 {@link QUICK_PROMPT_GROUPS}）。 */
  groupId: QuickPromptGroupId;
  titleKey: LocaleKey;
  promptKey: LocaleKey;
}

/** 二级目录的分组 id。 */
export type QuickPromptGroupId = 'understand' | 'deliver';

/** 一个二级目录分组（组标题的 i18n key）。 */
export interface QuickPromptGroup {
  id: QuickPromptGroupId;
  titleKey: LocaleKey;
}

export const QUICK_PROMPT_GROUPS: readonly QuickPromptGroup[] = [
  { id: 'understand', titleKey: 'chat.quick.group.understand' },
  { id: 'deliver', titleKey: 'chat.quick.group.deliver' },
] as const;

export const QUICK_PROMPTS: readonly QuickPrompt[] = [
  { id: 'explore', groupId: 'understand', titleKey: 'chat.quick.explore.title', promptKey: 'chat.quick.explore.prompt' },
  { id: 'review', groupId: 'understand', titleKey: 'chat.quick.review.title', promptKey: 'chat.quick.review.prompt' },
  { id: 'build', groupId: 'deliver', titleKey: 'chat.quick.build.title', promptKey: 'chat.quick.build.prompt' },
  { id: 'fix', groupId: 'deliver', titleKey: 'chat.quick.fix.title', promptKey: 'chat.quick.fix.prompt' },
] as const;

/**
 * 按组分组后的条目（组序 = {@link QUICK_PROMPT_GROUPS} 声明序,
 * 组内条目保持 {@link QUICK_PROMPTS} 声明序）。
 */
export function groupQuickPrompts(): { group: QuickPromptGroup; prompts: QuickPrompt[] }[] {
  return QUICK_PROMPT_GROUPS.map((group) => ({
    group,
    prompts: QUICK_PROMPTS.filter((p) => p.groupId === group.id),
  })).filter((entry) => entry.prompts.length > 0);
}
