/**
 * imageProvenance —— 图片附件的来源标注。
 *
 * 背景:粘贴 / 拖拽 / 选择器导入的图片一律以内联字节(`UserInputItem::Image`)
 * 提交,协议 item 只有 data + mime_type,模型无从得知出处(实测会先 glob/ls
 * 反推"这图是哪来的",白费一轮工具调用)。发送时在每个图片 item 前注入一条
 * 本地化标记文本 item,随消息进入 LLM 请求并落盘:
 *
 *   [图片 #1：剪贴板粘贴]
 *   [图片 #2：来自本地文件 /path/x.png]
 *
 * 形态对齐引擎对 File item 的 `@path` 独立文本块先例;回放侧(replay.ts)
 * 以 IMAGE_MARKER_RE 整块匹配还原成附件上的 source 字段,不渲染为用户
 * 正文 —— 与 FILE_MENTION_RE 同款约定。只认整块匹配,用户正文里手打的
 * 同形文本(概率极低)不受影响。
 */
import type { LocaleKey } from '@/utils/i18n';

/** 图片来源通道:paste=剪贴板粘贴 / bytes=DOM 拖拽或浏览器选择器(无可靠路径) / file=原生拖拽或原生选择器(绝对路径)。 */
export type ImageProvenance =
  | { channel: 'paste' }
  | { channel: 'bytes' }
  | { channel: 'file'; path: string };

/** 各通道的文案 key(挂在 composer.* 命名空间,文案形如 `图片 #{n}：…`)。 */
const KEY_BY_CHANNEL: Record<ImageProvenance['channel'], LocaleKey> = {
  paste: 'composer.imageSource.paste',
  bytes: 'composer.imageSource.bytes',
  file: 'composer.imageSource.file',
};

/** lookup.ts 同款翻译函数签名(避免整个 I18nContext 依赖,便于纯函数复用)。 */
type Translate = (key: LocaleKey, vars?: Record<string, string | number>) => string;

/**
 * 构建一条图片来源标记文本(含方括号包裹)。
 * `index` 为本条消息内的图片序号(1 起),跨附件类型连续计数。
 */
export function buildImageMarker(prov: ImageProvenance, index: number, t: Translate): string {
  const vars =
    prov.channel === 'file'
      ? { n: index, path: prov.path }
      : { n: index, path: '' };
  return `[${t(KEY_BY_CHANNEL[prov.channel], vars)}]`;
}

/**
 * 图片来源标记的整块匹配形态 —— 双语(en 前缀 `Image #N:`,zh-CN 前缀
 * `图片 #N：`),内容段不含 `]`(路径带 `]` 的概率可忽略,换取判别简单)。
 */
export const IMAGE_MARKER_RE = /^\[(?:图片|Image)\s*#\d+[:：][^\]]*\]$/;

/** 整块判定:该文本块是否为图片来源标记(replay 剥正文、turns 挂附件均用)。 */
export function isImageMarkerText(text: string): boolean {
  return IMAGE_MARKER_RE.test(text.trim());
}
