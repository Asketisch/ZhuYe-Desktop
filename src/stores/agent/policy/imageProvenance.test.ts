/**
 * Vitest — imageProvenance(图片来源标记:构建 / 整块判别)。
 *
 * 标记形态契约:发送时注入在图片 item 前,双语前缀必须与 IMAGE_MARKER_RE
 * 一致;replay 靠整块匹配剥正文、挂附件 source。
 */
import { describe, expect, it } from 'vitest';
import { t } from '@/utils/i18n';
import { buildImageMarker, isImageMarkerText } from './imageProvenance';
import type { LocaleKey } from '@/utils/i18n';

/** 固定 locale 的翻译函数(测试不依赖 I18nProvider)。 */
const translate =
  (locale: 'en' | 'zh-CN') => (key: LocaleKey, vars?: Record<string, string | number>) =>
    t(key, locale, vars);

describe('buildImageMarker', () => {
  it('paste 通道:双语形态均为 [前缀 #N:…]', () => {
    expect(buildImageMarker({ channel: 'paste' }, 1, translate('zh-CN'))).toBe('[图片 #1：剪贴板粘贴]');
    expect(buildImageMarker({ channel: 'paste' }, 2, translate('en'))).toBe('[Image #2: pasted from clipboard]');
  });

  it('bytes 通道:DOM 拖拽 / 浏览器选择器兜底', () => {
    expect(buildImageMarker({ channel: 'bytes' }, 3, translate('zh-CN'))).toBe('[图片 #3：拖拽或选择器导入]');
    expect(buildImageMarker({ channel: 'bytes' }, 1, translate('en'))).toBe(
      '[Image #1: imported via drag or file picker]',
    );
  });

  it('file 通道:携带源绝对路径', () => {
    expect(buildImageMarker({ channel: 'file', path: '/Users/me/Desktop/x.png' }, 2, translate('zh-CN'))).toBe(
      '[图片 #2：来自本地文件 /Users/me/Desktop/x.png]',
    );
    expect(buildImageMarker({ channel: 'file', path: '/tmp/a.png' }, 1, translate('en'))).toBe(
      '[Image #1: from local file /tmp/a.png]',
    );
  });
});

describe('isImageMarkerText(整块判别)', () => {
  it('识别 zh-CN / en 标记(含首尾空白)', () => {
    expect(isImageMarkerText('[图片 #1：剪贴板粘贴]')).toBe(true);
    expect(isImageMarkerText('[图片 #12：来自本地文件 /tmp/a.png]')).toBe(true);
    expect(isImageMarkerText('  [Image #2: pasted from clipboard]  ')).toBe(true);
    expect(isImageMarkerText('[Image #1: from local file /tmp/a.png]')).toBe(true);
  });

  it('拒绝非整块 / 缺编号 / 缺前缀的同形文本', () => {
    expect(isImageMarkerText('看看 [图片 #1：剪贴板粘贴] 这张')).toBe(false);
    expect(isImageMarkerText('[图片 #1]')).toBe(false);
    expect(isImageMarkerText('[剪贴板粘贴]')).toBe(false);
    expect(isImageMarkerText('[图片 #x：剪贴板粘贴]')).toBe(false);
    expect(isImageMarkerText('[Image 1: pasted]')).toBe(false);
    expect(isImageMarkerText('')).toBe(false);
  });

  it('构建出的标记全部能被 IMAGE_MARKER_RE 判别(往返自洽)', () => {
    const provs = [
      { channel: 'paste' as const },
      { channel: 'bytes' as const },
      { channel: 'file' as const, path: '/tmp/a.png' },
    ];
    for (const locale of ['zh-CN', 'en'] as const) {
      provs.forEach((prov, i) => {
        expect(isImageMarkerText(buildImageMarker(prov, i + 1, translate(locale)))).toBe(true);
      });
    }
  });
});
