/**
 * browserInput —— 面板输入的纯计算测试（坐标归一化 / 可打印文本 / 双击）。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizedPoint,
  printableText,
  trackClick,
  type ClickState,
} from '@/logic/workbench/browser/browserInput';
import { browserModifiersFrom } from '@/utils/commands/browser';

const RECT = { left: 100, top: 50, width: 400, height: 200 };

describe('normalizedPoint', () => {
  it('画面内的点换算成 0..1', () => {
    expect(normalizedPoint(100, 50, RECT)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(500, 250, RECT)).toEqual({ x: 1, y: 1 });
    expect(normalizedPoint(300, 150, RECT)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('画面外的点钳到边界（拖动滑出不跳到对侧）', () => {
    expect(normalizedPoint(-50, -50, RECT)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(9999, 9999, RECT)).toEqual({ x: 1, y: 1 });
  });

  it('零尺寸矩形不产生 NaN', () => {
    const p = normalizedPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 });
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});

describe('printableText', () => {
  it('可打印字符带 text', () => {
    expect(printableText('a')).toBe('a');
    expect(printableText('Z')).toBe('Z');
    expect(printableText('中')).toBe('中');
    expect(printableText(' ')).toBe(' ');
  });

  it('控制字符与功能键不带 text', () => {
    expect(printableText('Enter')).toBeUndefined();
    expect(printableText('Tab')).toBeUndefined();
    expect(printableText('Backspace')).toBeUndefined();
    expect(printableText('ArrowLeft')).toBeUndefined();
  });
});

describe('trackClick', () => {
  it('首次点击序号为 1', () => {
    const { count } = trackClick(null, 1000, 0.5, 0.5);
    expect(count).toBe(1);
  });

  it('短时间内同位置连续点击 → 序号递增', () => {
    const first = trackClick(null, 1000, 0.5, 0.5);
    const second = trackClick(first.state, 1100, 0.5, 0.5);
    expect(second.count).toBe(2);
    const third = trackClick(second.state, 1200, 0.5, 0.5);
    expect(third.count).toBe(3);
  });

  it('序号封顶 3', () => {
    let state: ClickState | null = null;
    for (let i = 0; i < 6; i++) {
      state = trackClick(state, 1000 + i * 10, 0.5, 0.5).state;
    }
    expect(state?.count).toBe(3);
  });

  it('间隔过大或位置不同 → 序号重置为 1', () => {
    const first = trackClick(null, 1000, 0.5, 0.5);
    expect(trackClick(first.state, 2000, 0.5, 0.5).count).toBe(1);
    expect(trackClick(first.state, 1100, 0.9, 0.5).count).toBe(1);
  });
});

describe('browserModifiersFrom', () => {
  it('按 CDP 位掩码合成（Alt=1 / Ctrl=2 / Meta=4 / Shift=8）', () => {
    expect(browserModifiersFrom({})).toBe(0);
    expect(browserModifiersFrom({ altKey: true })).toBe(1);
    expect(browserModifiersFrom({ ctrlKey: true })).toBe(2);
    expect(browserModifiersFrom({ metaKey: true })).toBe(4);
    expect(browserModifiersFrom({ shiftKey: true })).toBe(8);
    expect(
      browserModifiersFrom({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }),
    ).toBe(15);
  });
});
