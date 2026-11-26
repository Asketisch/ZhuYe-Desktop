/**
 * src/logic/usage/cacheHitRate.test.ts —— 缓存命中率口径的纯函数覆盖。
 *
 * 命中率是**比例**:任何来源(上游口径漂移 / 旧引擎 / 脏数据)都不该让
 * 界面显示出 > 100% 的荒谬值(真实事故:1052%)。
 */
import { describe, it, expect } from 'vitest';
import { cacheHitPercent, clampRate01 } from './cacheHitRate';

describe('cacheHitPercent', () => {
  it('按 cached / input 折成百分比', () => {
    expect(cacheHitPercent(250, 1000)).toBe(25);
    expect(cacheHitPercent(0, 1000)).toBe(0);
  });

  it('输入为 0 时返回 null(无法计算)', () => {
    expect(cacheHitPercent(0, 0)).toBeNull();
    expect(cacheHitPercent(100, 0)).toBeNull();
  });

  it('上游口径漂移(cached > input)时钳到 100%', () => {
    // 旧引擎 / 未折入缓存分段的历史数据:41486 / 3942 = 1052%。
    expect(cacheHitPercent(41486, 3942)).toBe(100);
  });

  it('负数与非法值不产生 NaN', () => {
    expect(cacheHitPercent(-10, 1000)).toBe(0);
    expect(cacheHitPercent(Number.NaN, 1000)).toBe(0);
  });
});

describe('clampRate01', () => {
  it('比例钳到 [0, 1]', () => {
    expect(clampRate01(0.25)).toBe(0.25);
    expect(clampRate01(10.52)).toBe(1);
    expect(clampRate01(-1)).toBe(0);
    expect(clampRate01(Number.NaN)).toBe(0);
  });
});
