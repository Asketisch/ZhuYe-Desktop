/**
 * ContextRing —— 上下文用量圆环（CSS Modules 版）。
 *
 * 5 个分类 segment:tools / system / skills / messages / other
 */
import { ringGeometry, segmentArc } from '@/logic/design-system/utils/ring';
import type { RingSegment } from '@/logic/design-system/utils/ring';
import s from '@/render/design-system/primitives/ContextRing.module.css';

export interface ContextRingProps {
  segments: RingSegment[];
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export function ContextRing({ segments, size = 40, strokeWidth = 4, label }: ContextRingProps) {
  const geom = ringGeometry(size, strokeWidth);
  let cursor = 0;
  return (
    <span className={s.wrap}>
      <svg width={size} height={size} role="img" aria-label={label ?? 'context ring'}>
        <circle
          cx={geom.cx}
          cy={geom.cy}
          r={geom.radius}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, i) => {
          const arc = segmentArc(geom, cursor, Math.max(0, Math.min(1, seg.value)));
          cursor += seg.value;
          return (
            <circle
              key={i}
              cx={geom.cx}
              cy={geom.cy}
              r={geom.radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
              transform={`rotate(-90 ${geom.cx} ${geom.cy})`}
            />
          );
        })}
      </svg>
      {label && <span className={s.label}>{label}</span>}
    </span>
  );
}
