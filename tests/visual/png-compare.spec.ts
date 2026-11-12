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

  it('rejects a pixel or dimension change', () => {
    expect(comparePng(makePng(2, 2, 42, 0), makePng(2, 2, 43, 0))).toEqual({ equal: false, detail: '4/4 像素不同' });
    expect(comparePng(makePng(2, 2, 42, 0), makePng(1, 4, 42, 0)).equal).toBe(false);
  });
});
