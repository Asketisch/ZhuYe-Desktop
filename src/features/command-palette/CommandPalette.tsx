/**
 * CommandPalette —— ⌘K 全局命令面板 (B10-01).
 *
 * - 模态浮层 + 输入框 + 模糊匹配列表
 * - Enter 触发,↑↓ 选择,Esc 关闭
 * - 注册到全局 keymap (useGlobalKeys) + 在 AppShell 渲染一份
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { buildPaletteItems, type PaletteItem } from './registry';
import { fuzzy } from './fuzzy';
import s from './CommandPalette.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  navigate: (to: string) => void;
  cycleTheme: () => void;
  setTheme: (mode: 'light' | 'dark' | 'system') => void;
  resolvedTheme: 'light' | 'dark';
  newSession: () => void;
  clearAllSessions: () => void;
  exportActive: () => void;
  exportActiveMarkdown: () => void;
  saveConfig: () => void;
  runSlash: (slash: string) => void;
}

const MAX_VISIBLE = 30;

export function CommandPalette(props: CommandPaletteProps) {
  const {
    open, onClose, navigate, cycleTheme, setTheme, resolvedTheme,
    newSession, clearAllSessions, exportActive, exportActiveMarkdown, saveConfig, runSlash,
  } = props;
  const { t } = useI18n();

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 每次打开时重新构建 items（当前状态影响 `theme.now` 等）。
  const items = useMemo(
    () =>
      buildPaletteItems({
        navigate,
        cycleTheme,
        setTheme,
        resolvedTheme,
        newSession,
        clearAllSessions,
        exportActive,
        exportActiveMarkdown,
        saveConfig,
      }),
    [navigate, cycleTheme, setTheme, resolvedTheme, newSession, clearAllSessions, exportActive, exportActiveMarkdown, saveConfig],
  );

  const hits = useMemo(() => {
    const r = fuzzy(query, items, {
      getLabel: (item) => (item.labelKey === 'palette.item.themeCurrent' ? t(item.labelKey, { theme: resolvedTheme }) : t(item.labelKey)),
      getHint: (item) => (item.hintKey ? t(item.hintKey) : undefined),
      getKeywords: (item) => item.keywords,
    });
    return r.slice(0, MAX_VISIBLE).map((h) => h.item);
  }, [query, items, t, resolvedTheme]);

  // 打开时重置状态。
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // 在 modal 渲染后聚焦输入框。
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 保持 activeIdx 在有效范围内。
  useEffect(() => {
    if (activeIdx >= hits.length) setActiveIdx(Math.max(0, hits.length - 1));
  }, [hits, activeIdx]);

  // 将活动行滚动到可视区域。
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, hits]);

  if (!open) return null;

  const run = (item: PaletteItem) => {
    if (item.to) navigate(item.to);
    else if (item.slash) runSlash(item.slash);
    else item.run?.();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = hits[activeIdx];
      if (it) run(it);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className={s.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.ariaLabel')}
      data-testid="command-palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.modal} onKeyDown={onKey}>
        <div className={s.inputRow}>
          <Icon icon={Search} size={14} className={s.searchIcon} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder={t('palette.placeholder')}
            className={s.input}
            data-testid="command-palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={s.kbd}>{t('palette.esc')}</kbd>
        </div>
        <ul ref={listRef} className={s.list} role="listbox" aria-label="Commands">
          {hits.length === 0 ? (
            <li className={s.emptyRow} data-testid="command-palette-empty">
              {t('palette.empty')}
            </li>
          ) : (
            hits.map((item, i) => (
              <li
                key={item.id}
                className={s.row}
                data-active={i === activeIdx || undefined}
                data-idx={i}
                data-testid={`command-palette-item-${item.id}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => run(item)}
                role="option"
                aria-selected={i === activeIdx}
              >
                <Icon icon={item.icon} size={13} className={s.rowIcon} />
                <div className={s.rowBody}>
                  <div className={s.rowLabel}>{item.labelKey === 'palette.item.themeCurrent' ? t(item.labelKey, { theme: resolvedTheme }) : t(item.labelKey)}</div>
                  {item.hintKey && <div className={s.rowHint}>{t(item.hintKey)}</div>}
                </div>
                <span className={s.rowKind}>{t(`palette.kind.${item.kind}`)}</span>
                {i === activeIdx && <Icon icon={CornerDownLeft} size={11} className={s.enterIcon} />}
              </li>
            ))
          )}
        </ul>
        <div className={s.footer}>
          <span className={s.footHint}>
            <Icon icon={ArrowUp} size={10} /> <Icon icon={ArrowDown} size={10} /> {t('palette.navigate')}
          </span>
          <span className={s.footHint}>
            <Icon icon={CornerDownLeft} size={10} /> {t('palette.select')}
          </span>
          <span className={s.footHint}>{t('palette.escClose')}</span>
        </div>
      </div>
    </div>
  );
}