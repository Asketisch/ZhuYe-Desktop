/**
 * localStorage 键前缀一次性迁移（`reflect.*` → `zhuye.*`）。
 *
 * 桌面更名（Reflect → ZhuYe）后，旧前缀键承载的用户数据——草稿、
 * 提示词历史、界面偏好、会话置顶等——必须搬到新前缀，否则升级后
 * 全部「丢失」。策略：目标键不存在才复制，复制后删除旧键；幂等
 * 可重入，旧键不存在时零开销。
 */

const LEGACY_PREFIX = 'reflect.';
const NEW_PREFIX = 'zhuye.';

export function migrateReflectStorageKeys(storage: Storage = localStorage): void {
  try {
    const legacy: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
    }
    for (const key of legacy) {
      const next = `${NEW_PREFIX}${key.slice(LEGACY_PREFIX.length)}`;
      if (storage.getItem(next) === null) {
        const value = storage.getItem(key);
        if (value !== null) storage.setItem(next, value);
      }
      storage.removeItem(key);
    }
  } catch {
    /* 存储不可用（隐私模式等）时静默跳过，偏好降级为默认值 */
  }
}
