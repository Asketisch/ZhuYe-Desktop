/**
 * localStorage 键前缀迁移测试（`zhuye.*` → `zhuye.*`）。
 * 覆盖：搬运、幂等、目标键已存在时不覆盖、非旧前缀键不受影响。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { migrateReflectStorageKeys } from './localStorageMigrate';

describe('migrateReflectStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('把旧前缀键搬到新前缀并删除旧键', () => {
    localStorage.setItem('reflect.draft.sess-1', '草稿A');
    localStorage.setItem('reflect.locale', 'en');

    migrateReflectStorageKeys();

    expect(localStorage.getItem('zhuye.draft.sess-1')).toBe('草稿A');
    expect(localStorage.getItem('zhuye.locale')).toBe('en');
    expect(localStorage.getItem('reflect.draft.sess-1')).toBeNull();
    expect(localStorage.getItem('reflect.locale')).toBeNull();
  });

  it('幂等：无旧键时零操作', () => {
    localStorage.setItem('zhuye.uiprefs.v1', '{}');

    migrateReflectStorageKeys();

    expect(localStorage.getItem('zhuye.uiprefs.v1')).toBe('{}');
    expect(localStorage.length).toBe(1);
  });

  it('目标键已存在时不覆盖新值', () => {
    localStorage.setItem('reflect.draft.s', '旧值');
    localStorage.setItem('zhuye.draft.s', '新值');

    migrateReflectStorageKeys();

    expect(localStorage.getItem('zhuye.draft.s')).toBe('新值');
    expect(localStorage.getItem('reflect.draft.s')).toBeNull();
  });

  it('非旧前缀键不受影响', () => {
    localStorage.setItem('zhuye-harness-ui', '{}');
    localStorage.setItem('unrelated', 'x');

    migrateReflectStorageKeys();

    expect(localStorage.getItem('zhuye-harness-ui')).toBe('{}');
    expect(localStorage.getItem('unrelated')).toBe('x');
  });
});
