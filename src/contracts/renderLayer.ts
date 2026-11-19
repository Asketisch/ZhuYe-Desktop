import type { ComponentType } from 'react';

/**
 * 页面注入的子组件表。所有键均可由替代界面重新提供。
 * 当前使用宽松记录，后续随剩余子组件迁移逐步收窄。
 */
export type RenderSlots = Record<string, ComponentType<any>>;
