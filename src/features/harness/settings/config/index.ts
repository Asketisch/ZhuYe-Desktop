/**
 * 纯配置层的 barrel 再导出。
 *
 * 从旧版 `configSchema.tsx` + `ConfigForm.tsx` 中拆出，
 * 使 schema 元数据、TOML 字符串辅助函数和 React 组件
 * 可以独立测试与消费。
 */

export * from '@/logic/settings/config/schema';
export * from '@/logic/settings/config/toml';