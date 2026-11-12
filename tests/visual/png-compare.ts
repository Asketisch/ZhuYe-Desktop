import { PNG } from 'pngjs';

/** 对解码后的 RGBA 像素进行零容差比较，不依赖 PNG 编码或元数据。 */
export function comparePng(actual: Buffer, expected: Buffer): { equal: boolean; detail: string } {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height) {
    return { equal: false, detail: `尺寸 ${a.width}×${a.height} ≠ ${b.width}×${b.height}` };
  }
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) different++;
  }
  return { equal: different === 0, detail: `${different}/${a.width * a.height} 像素不同` };
}
