/**
 * Vitest — ring 工具测试。
 */
import { describe, it, expect } from 'vitest';
import { ringGeometry, segmentArc } from './ring';

describe('ringGeometry', () => {
  it('computes geometry from size + stroke', () => {
    const g = ringGeometry(40, 4);
    expect(g.cx).toBe(20);
    expect(g.cy).toBe(20);
    expect(g.radius).toBe(18);
    // circumference = 2π·18 ≈ 113.097
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 18, 3);
  });
});

describe('segmentArc', () => {
  it('full circle segment has no gap', () => {
    const g = ringGeometry(40, 4);
    const arc = segmentArc(g, 0, 1);
    expect(arc.dasharray).toMatch(/^113\.09/);
    expect(arc.dashoffset).toBeCloseTo(0, 3);
  });

  it('half segment has visible = circumference/2', () => {
    const g = ringGeometry(40, 4);
    const arc = segmentArc(g, 0, 0.5);
    expect(arc.dasharray.startsWith(arc.dasharray.split(' ')[0])).toBe(true);
    // 第一个 token 应为圆周长的一半
    const visible = parseFloat(arc.dasharray.split(' ')[0]);
    expect(visible).toBeCloseTo(g.circumference / 2, 3);
  });

  it('starts at correct offset', () => {
    const g = ringGeometry(40, 4);
    const arc = segmentArc(g, 0.25, 0.5);
    expect(arc.dashoffset).toBeCloseTo(-0.25 * g.circumference, 3);
  });
});