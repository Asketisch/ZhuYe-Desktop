/**
 * BottomTabs —— 底部分屏:终端 | 浏览器 | 预览(v2-shell-redesign)。
 *
 * 终端 = 系统 shell 的交互式伪终端;
 * 预览 = zhuye_read_file 读取工作区文件做只读预览;
 * 浏览器 = 占位面板(内嵌浏览器尚未接线,给出诚实提示与替代入口)。
 * chat 路由渲染;头部终端开关控制显隐。
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Globe, Eye, Plus, FileText } from 'lucide-react';
import { zhuye_read_file } from '@/utils/commands/files';
import { useI18n } from '@/utils/i18n';
import { InteractiveTerminal } from '@/features/workbench/terminal/InteractiveTerminal';
import s from '@/render/shell/session/session.module.css';

type BottomTab = 'term' | 'browser' | 'preview';

export function BottomTabs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<BottomTab>('term');
  const hasOpened = useRef(false);
  if (open) hasOpened.current = true;
  const [previewPath, setPreviewPath] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'preview' || !previewPath.trim()) return;
    const ctrl = new AbortController();
    zhuye_read_file(previewPath.trim())
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

  return (
    <div className={s.bottom} data-testid="session-bottom" hidden={!open}>
      <div className={s.bottomBar}>
        <div className={s.btabs} role="tablist" aria-label={t('bottom.terminal')}>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'term'} aria-selected={tab === 'term'} data-testid="session-bottom-term" onClick={() => setTab('term')}>
            <TerminalIcon size={12} /> {t('bottom.terminal')}
          </button>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'browser'} aria-selected={tab === 'browser'} data-testid="session-bottom-browser" onClick={() => setTab('browser')}>
            <Globe size={12} /> {t('bottom.browser')}
          </button>
          <button type="button" role="tab" className={s.btab} data-active={tab === 'preview'} aria-selected={tab === 'preview'} data-testid="session-bottom-preview" onClick={() => setTab('preview')}>
            <Eye size={12} /> {t('bottom.preview')}
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className={s.btab} aria-label={t('head.terminal')} onClick={onClose}>
          <Plus size={13} style={{ transform: 'rotate(45deg)' }} />
        </button>
      </div>

      <div className={s.bbody} data-active={tab === 'term'}>
        {hasOpened.current && <InteractiveTerminal />}
      </div>

      <div className={s.bbody} data-active={tab === 'browser'}>
        <div className={s.urlbar}>
          <Globe size={13} />
          <span className={s.urlInput}>about:blank</span>
        </div>
        <div className={s.viewport}>
          <Globe size={26} />
          <span>{t('bottom.browserHint')}</span>
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
            placeholder={t('bottom.previewPath')}
            aria-label={t('bottom.previewPath')}
          />
        </div>
        {previewErr ? (
          <div className={s.previewBody} style={{ color: 'var(--danger)' }}>{previewErr}</div>
        ) : previewText != null ? (
          <div className={s.previewBody}>{previewText}</div>
        ) : (
          <div className={s.viewport}>{t('bottom.previewEmpty')}</div>
        )}
      </div>
    </div>
  );
}
