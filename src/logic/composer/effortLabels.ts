/**
 * 思考强度档位文案 —— 各 UI 面统一的本地化映射。
 *
 * composer 的 EffortPicker 直接走 `composer.effort.*` i18n 键;设置页
 * 「默认思考强度」下拉、Models 页分段控件与设置页模型徽标还会出现
 * **厂商原始档位词**(models.dev `effort_levels`,如 qwen 系的
 * low/medium/xhigh)—— 本 helper 统一转成中文文案(低/中/极高…),
 * 词表外的未知档位回退原串。
 */
import type { I18nContextValue } from '@/utils/i18n/context';

/** 已知档位词 → i18n 键(含 models.dev 目录出现的厂商扩展档)。 */
const EFFORT_KEYS = {
  low: 'composer.effort.low',
  medium: 'composer.effort.medium',
  high: 'composer.effort.high',
  max: 'composer.effort.max',
  ultra: 'composer.effort.ultra',
  xhigh: 'composer.effort.xhigh',
  minimal: 'composer.effort.minimal',
  none: 'composer.effort.none',
} as const;

/** 档位 → 本地化文案;未知档位原样返回(不显示 i18n 键名)。 */
export function effortLabel(t: I18nContextValue['t'], level: string): string {
  const key = EFFORT_KEYS[level.trim().toLowerCase() as keyof typeof EFFORT_KEYS];
  return key ? t(key) : level;
}
