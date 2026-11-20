import { PNG } from 'pngjs';

/**
 * 视觉基线比较容差。
 *
 * 真实回归(如整壳换装)会命中数十万级像素;这里的预算只为吸收
 * 字体反锯齿与子像素渲染在 CI runner 上的逐帧抖动 —— 实测同一份
 * bundle 在同镜像 runner 上两次渲染会有 1~2/1024000 像素(单通道
 * ±1~2)的随机漂移,零容差会把发布门禁变成掷硬币。
 */
/** 单通道容差:反锯齿灰阶抖动的量级。 */
const CHANNEL_TOLERANCE = 2;
/** 像素预算:不同像素占比超过该值才算回归。 */
const MAX_DIFF_RATIO = 0.0005;

/** 对解码后的 RGBA 像素进行带容差比较,不依赖 PNG 编码或元数据。 */
export function comparePng(actual: Buffer, expected: Buffer): { equal: boolean; detail: string } {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height) {
    return { equal: false, detail: `尺寸 ${a.width}×${a.height} ≠ ${b.width}×${b.height}` };
  }
  let different = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    if (dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE ||
        db > CHANNEL_TOLERANCE || da > CHANNEL_TOLERANCE) different++;
  }
  const ratio = different / total;
  return {
    equal: ratio <= MAX_DIFF_RATIO,
    detail: `${different}/${total} 像素不同（容差 ±${CHANNEL_TOLERANCE}/通道，预算 ${MAX_DIFF_RATIO * 100}%）`,
  };
}
