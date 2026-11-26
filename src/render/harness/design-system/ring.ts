/**
 * ContextRing 工具 —— SVG ring 计算。
 */
export interface RingSegment {
  label: string;
  value: number; // 0..1
  color: string;
}

export interface RingGeometry {
  cx: number;
  cy: number;
  radius: number;
  circumference: number;
}

export function ringGeometry(size: number, strokeWidth: number): RingGeometry {
  const radius = (size - strokeWidth) / 2;
  return {
    cx: size / 2,
    cy: size / 2,
    radius,
    circumference: 2 * Math.PI * radius,
  };
}

/** 单个分段 SVG 弧参数。 */
export function segmentArc(
  geom: RingGeometry,
  startFraction: number,
  lengthFraction: number,
): { dasharray: string; dashoffset: number } {
  const visible = lengthFraction * geom.circumference;
  const gap = geom.circumference - visible;
  const offset = -startFraction * geom.circumference;
  return {
    dasharray: `${visible} ${gap}`,
    dashoffset: offset,
  };
}