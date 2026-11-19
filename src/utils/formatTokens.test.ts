import { describe, expect, it } from 'vitest';
import { formatTokens } from './formatTokens';

describe('formatTokens', () => {
  it('千位缩写为 K(四舍五入)', () => {
    expect(formatTokens(8192)).toBe('8K');
    expect(formatTokens(200000)).toBe('200K');
    expect(formatTokens(128000)).toBe('128K');
    expect(formatTokens(999)).toBe('999');
  });

  it('百万缩写为 M(最多一位小数,去尾零)', () => {
    expect(formatTokens(1048576)).toBe('1M');
    expect(formatTokens(1000000)).toBe('1M');
    expect(formatTokens(1572864)).toBe('1.6M');
    expect(formatTokens(204800)).toBe('205K');
  });

  it('非正数与非有限数返回空串(标签自然省略)', () => {
    expect(formatTokens(0)).toBe('');
    expect(formatTokens(-1000)).toBe('');
    expect(formatTokens(Number.NaN)).toBe('');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('');
  });
});
