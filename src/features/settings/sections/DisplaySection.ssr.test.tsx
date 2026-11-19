/**
 * DisplaySection SSR 证据 —— 通过真实的 react-dom/server 渲染器绘制
 * <DisplaySection />，并将生成的 HTML 转储到 docs/screenshots/display-section.real.html。
 * 该测试存在是为了证明四张卡片（主题 / 强调色 / 透明度 / 背景图）
 * 来自真实的 React 组件树，而非手绘示意图。
 *
 * 运行：pnpm test -- src/features/settings/sections/DisplaySection.ssr.test.tsx
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
// @ts-ignore —— 仅运行时的 node 导入；vitest 环境在测试时包含它们。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
// @ts-ignore
import { dirname, resolve } from 'node:path';
// @ts-ignore
import { fileURLToPath } from 'node:url';
import React from 'react';
import { I18nProvider } from '@/utils/i18n';
import { DisplaySection } from '@/features/settings/sections/DisplaySection';
import { applyUiPrefs, getUiPrefs } from '@/utils/uiPrefs';

// @ts-ignore
const HERE = dirname(fileURLToPath(import.meta.url));
// @ts-ignore
const ROOT = resolve(HERE, '../../../..');

async function bundleCss(): Promise<string> {
  const [tokens, base, settings] = await Promise.all([
    readFile(resolve(ROOT, 'src/render/styles/tokens.css'), 'utf8').catch(() => ''),
    readFile(resolve(ROOT, 'src/render/styles/base.css'), 'utf8').catch(() => ''),
    readFile(resolve(ROOT, 'src/render/settings/SettingsView.module.css'), 'utf8').catch(() => ''),
  ]);
  return [tokens, base, settings].join('\n');
}

describe('DisplaySection SSR evidence', () => {
  it('renders all four primary Cards (Theme / Accent color / Transparency / Background image)', async () => {
    // 预置一个有意义的默认值，让 SSR 快照显示非初始状态。
    applyUiPrefs({ ...getUiPrefs(), accentColor: '#60a5fa', surfaceOpacity: 0.7, reduceTransparency: false });

    const css = await bundleCss();
    const markup = renderToString(
      React.createElement(I18nProvider, null, React.createElement(DisplaySection)),
    );

    expect(markup).toContain('Theme');
    expect(markup).toContain('Accent color');
    expect(markup).toContain('Transparency');
    expect(markup).toContain('Background image');

    // 控件可用性断言 —— 证明这些是真实可交互的元素
    expect(markup).toMatch(/System[\s\S]*Dark[\s\S]*Light/);
    expect(markup).toMatch(/type="color"/);
    expect(markup).toMatch(/type="range"/);
    expect(markup).toMatch(/type="url"/);
    expect(markup).toMatch(/type="file"/);
    expect(markup).toContain('Surface opacity');
    expect(markup).toContain('Reduce transparency');
    expect(markup).toContain('Choose image');
    expect(markup).toContain('Reset');
    expect(markup).toContain('#60a5fa');
    expect(markup).toContain('aria-label="Custom accent color"');
    expect(markup).toContain('aria-label="Background image URL"');
    // 6 个强调色预设色板
    const swatchCount = (markup.match(/class="_colorSwatch_/g) ?? []).length;
    expect(swatchCount).toBe(6);

    // 写入证据文件
    await mkdir(resolve(ROOT, 'docs/screenshots'), { recursive: true });
    const cssInlined = css.replace(/<\/style>/g, '<\\/style>');
    const fullHtml = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<title>DisplaySection (real SSR)</title>
<style>${cssInlined}</style>
</head>
<body>
<div id="root">${markup}</div>
</body>
</html>`;
    const htmlPath = resolve(ROOT, 'docs/screenshots/display-section.real.html');
    await writeFile(htmlPath, fullHtml, 'utf8');

    // 完整性转储
    const headings = Array.from(new Set([
      'Theme',
      'Accent color',
      'Transparency',
      'Background image',
    ]));
    const jsonPath = resolve(ROOT, 'docs/screenshots/display-section.real.json');
    await writeFile(
      jsonPath,
      JSON.stringify({ headings, markupBytes: markup.length, htmlBytes: fullHtml.length }, null, 2),
      'utf8',
    );

    console.log('SSR HTML written to:', htmlPath, '(', fullHtml.length, 'bytes )');
    console.log('SSR JSON written to:', jsonPath);
  });
});
