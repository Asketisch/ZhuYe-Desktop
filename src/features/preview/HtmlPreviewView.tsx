/**
 * HTML 产物预览(v1.11 D1 轻版)。
 *
 * agent 生成的网页/HTML 产物此前只能手动复制路径去系统浏览器打开
 * (体验断点,gap-report D1)。本视图用 iframe srcDoc 渲染工作区内
 * 的 .html 文件 —— 纯静态 HTML/CSS 预览,不承诺 JS 水合(那是 D1
 * 完整版「受控浏览器」的范围,见 gap-docs/remote-dependent-features.md)。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCode2 } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Button, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_read_file } from '@/utils/commands';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import s from './HtmlPreviewView.module.css';

export function HtmlPreviewView() {
  const { t } = useI18n();
  const { currentWorkspace } = useCurrentWorkspace();
  const [relPath, setRelPath] = useState('');
  const [submitted, setSubmitted] = useState('');

  // 相对路径 → 绝对路径由后端 read 工具解析(workspace 边界内)。
  const fileQ = useQuery({
    queryKey: ['html-preview', submitted],
    queryFn: () => reflect_read_file(submitted),
    enabled: submitted.trim().length > 0,
    retry: false,
  });

  const content = fileQ.data?.content ?? '';
  const isHtml = /\.html?$/i.test(submitted);

  return (
    <PageShell
      icon={FileCode2}
      title={t('preview.title')}
      subtitle={t('preview.subtitle')}
      width="lg"
    >
      <Card level="flat" padding="lg">
        <div className={s.row}>
          <Input
            value={relPath}
            onChange={(e) => setRelPath(e.target.value)}
            placeholder={t('preview.placeholder')}
            aria-label={t('preview.pathLabel')}
            data-testid="preview-path-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSubmitted(relPath.trim());
            }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!relPath.trim()}
            onClick={() => setSubmitted(relPath.trim())}
            data-testid="preview-open-btn"
          >
            {t('preview.open')}
          </Button>
        </div>
        <p className={s.hint}>
          {t('preview.workspaceHint')} <code>{currentWorkspace ?? '…'}</code>
        </p>
        {fileQ.isError && (
          <Badge variant="warning" data-testid="preview-error">
            {t('preview.readFailed')}
          </Badge>
        )}
        {fileQ.isLoading && <Badge variant="neutral">{t('common.loading')}</Badge>}
      </Card>

      {content && (
        <Card level="flat" padding="none" className={s.frameCard}>
          {/* srcDoc 沙箱:allow-samplescripts 关闭(静态预览不执行脚本)。 */}
          <iframe
            title={t('preview.title')}
            className={s.frame}
            sandbox=""
            srcDoc={content}
            data-testid="preview-frame"
          />
          {!isHtml && (
            <div className={s.rawFallback}>
              <Badge variant="info">{t('preview.rawFallback')}</Badge>
              <pre className={s.rawPre}>{content.slice(0, 4000)}</pre>
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}
