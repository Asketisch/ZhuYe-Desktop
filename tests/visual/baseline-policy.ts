/** 判断缺失基线是否允许写入；严格环境只能显式进入基线生成模式。 */
export function canWriteBaseline(explicit: boolean, strict: boolean): boolean {
  return explicit || !strict;
}
