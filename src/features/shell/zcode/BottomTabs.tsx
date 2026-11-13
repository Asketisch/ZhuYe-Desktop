/**
 * BottomTabs —— 底部分屏:终端 | 浏览器 | 预览(redesign/zcode-shell)。
 *
 * 终端 = 既有 TerminalView(真实 shell 会话,零新 IPC);
 * 预览 = reflect_read_file 读取工作区文件做只读预览;
 * 浏览器 = 占位面板(内嵌浏览器尚未接线,给出诚实提示与替代入口)。
 * 仅 chat 路由渲染;头部终端开关控制显隐。
 */
import { useEffect, useState } from 'react';
import { Terminal as TerminalIcon, Globe, Eye, Plus, FileText } from 'lucide-react';
import { reflect_read_file } from '@/utils/commands/files';
import { useI18n } from '@/utils/i18n';
import { TerminalView } from '@/features/terminal/TerminalView';
import s from './zcode.module.css';

type BottomTab = 'term' | 'browser' | 'preview';

export function BottomTabs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<BottomTab>('term');
  const [previewPath, setPreviewPath] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'preview' || !previewPath.trim()) return;
    const ctrl = new AbortController();
    reflect_read_file(previewPath.trim())
      .then((r) => {
        if (ctrl.signal.aborted) return;
        const res = r as unknown as { content?: string; text?: string };
        setPreviewText(res?.content ?? res?.text ?? '');
        setPreviewErr(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setPreviewText(null);
        setPreviewErr(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [tab, previewPath]);

  if (!open) return null;

  return (
    <div className={s.bottom} data-testid="zcode-bottom">
      <div className={s.bottomBar}>
        <div className={s.btabs} role="tablist" aria-label={t('zcode.bottom.terminal')}>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'term'} aria-selected={tab === 'term'} data-testid="zcode-bottom-term" onClick={() => setTab('term')}>
            <TerminalIcon size={12} /> {t('zcode.bottom.terminal')}
          </button>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'browser'} aria-selected={tab === 'browser'} data-testid="zcode-bottom-browser" onClick={() => setTab('browser')}>
            <Globe size={12} /> {t('zcode.bottom.browser')}
          </button>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'preview'} aria-selected={tab === 'preview'} data-testid="zcode-bottom-preview" onClick={() => setTab('preview')}>
            <Eye size={12} /> {t('zcode.bottom.preview')}
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className={s.btab} aria-label={t('zcode.head.terminal')} onClick={onClose}>
          <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
        </button>
      </div>

      <div className={s.bbody} data-active={tab === 'term'}>
        <TerminalView />
      </div>

      <div className={s.bbody} data-active={tab === 'browser'}>
        <div className={s.urlbar}>
          <Globe size={13} />
          <span className={s.urlInput}>about:blank</span>
        </div>
        <div className={s.viewport}>
          <Globe size={26} />
          <span>{t('zcode.bottom.browserHint')}</span>
        </div>
      </div>

      <div className={s.bbody} data-active={tab === 'preview'}>
        <div className={s.urlbar}>
          <FileText size={13} />
          <input
            className={s.urlInput}
            style={{ border: 'none', background: 'transparent' }}
            value={previewPath}
            onChange={(e) => setPreviewPath(e.target.value)}
            placeholder={t('zcode.bottom.previewPath')}
            aria-label={t('zcode.bottom.previewPath')}
          />
        </div>
        {previewErr ? (
          <div className={s.previewBody} style={{ color: 'var(--danger)' }}>{previewErr}</div>
        ) : previewText != null ? (
          <div className={s.previewBody}>{previewText}</div>
        ) : (
          <div className={s.viewport}>{t('zcode.bottom.previewEmpty')}</div>
        )}
      </div>
    </div>
  );
}
