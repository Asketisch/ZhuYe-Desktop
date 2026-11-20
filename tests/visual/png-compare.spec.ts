import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { comparePng } from './png-compare';

function makePng(width: number, height: number, value: number, deflateLevel: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(value);
  return PNG.sync.write(png, { deflateLevel });
}

describe('visual PNG comparison', () => {
  it('accepts identical pixels encoded with different compression', () => {
    const uncompressed = makePng(10, 10, 42, 0);
    const compressed = makePng(10, 10, 42, 9);
    expect(uncompressed.equals(compressed)).toBe(false);
    expect(comparePng(uncompressed, compressed).equal).toBe(true);
  });

  it('absorbs sub-tolerance AA jitter but rejects pixel or dimension changes', () => {
    // ±1/通道(4 像素各差 1)在通道容差内 → 视为一致。
    expect(comparePng(makePng(2, 2, 42, 0), makePng(2, 2, 43, 0)).equal).toBe(true);
    // 超出通道容差(4 像素全通道 +30,占 100% > 0.05% 预算)→ 拒绝。
    expect(comparePng(makePng(2, 2, 42, 0), makePng(2, 2, 72, 0))).toEqual({
      equal: false,
      detail: '4/4 像素不同（容差 ±2/通道，预算 0.05%）',
    });
    // 尺寸变化仍拒绝。
    expect(comparePng(makePng(2, 2, 42, 0), makePng(1, 4, 42, 0)).equal).toBe(false);
  });
});
