/**
 * TerminalDock —— 底部停靠的系统级终端面板（真 PTY）。
 *
 * 每个标签 = 一个独立 PTY 会话（macOS: $SHELL（默认 zsh）/ Linux: $SHELL /
 * Windows: PowerShell ≥ cmd，见 src-tauri/src/commands/pty.rs）。
 * xterm.js 实例在标签首次打开时创建并保持存活（隐藏不销毁），关闭标签
 * 才回收后端 PTY。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';
import { InteractiveTerminal } from '@/features/workbench/terminal/InteractiveTerminal';

interface TermTab {
  id: string;
  title: string;
}

export function TerminalDock() {
  const { t } = useI18n();
  const termOpen = useShellUi((s) => s.termOpen);
  const setTermOpen = useShellUi((s) => s.setTermOpen);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const seq = useRef(0);

  const newTab = useCallback(() => {
    seq.current += 1;
    const id = `term-${seq.current}-${Date.now().toString(36)}`;
    setTabs((prev) => [...prev, { id, title: `${t('harness.term.tab')} ${seq.current}` }]);
    setActiveId(id);
  }, [t]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      setActiveId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      // 最后一个 tab 关闭 → 自动收起面板(实测 bug #7:否则留一条空白
      // dock 条占位)。termOpen=false 会同步重置 createdRef,下次打开
      // 自动补开新 tab,行为闭环。
      if (next.length === 0) setTermOpen(false);
      return next;
    });
  }, [setTermOpen]);

  // 面板打开但没有任何标签 → 自动开一个。
  // createdRef 防护 StrictMode 双调用（两次 effect 共享同一份 stale 的
  // tabs.length === 0 闭包，会建出两个标签）。
  const createdRef = useRef(false);
  useEffect(() => {
    if (termOpen && tabs.length === 0 && !createdRef.current) {
      createdRef.current = true;
      newTab();
    }
    if (!termOpen) createdRef.current = false;
    // tabs.length 变化时不再自动补开 —— 只有从 0 恢复时补。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termOpen]);

  return (
    <section
      className="term-panel"
      data-testid="harness-terminal"
      style={maximized ? { height: '70vh' } : undefined}
    >
      <div className="tp-head">
        {tabs.map((tab) => (
          <span key={tab.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              className={`tp-tab${tab.id === activeId ? ' on' : ''}`}
              onClick={() => setActiveId(tab.id)}
              data-testid={`harness-terminal-tab-${tab.id}`}
            >
              {tab.title}
            </button>
            <button
              type="button"
              className="tb-btn"
              style={{ width: 18, height: 18 }}
              aria-label={t('harness.term.close')}
              onClick={() => closeTab(tab.id)}
              data-testid={`harness-terminal-close-tab-${tab.id}`}
            >
              <X size={11} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}
        <button type="button" className="tb-btn" title={t('harness.term.newTab')} onClick={newTab} data-testid="harness-terminal-new">
          <Plus size={13} strokeWidth={1.5} aria-hidden />
        </button>
        <span className="tp-spacer" />
        <button
          type="button"
          className="tb-btn"
          title={t('harness.term.maximize')}
          onClick={() => setMaximized((v) => !v)}
          data-testid="harness-terminal-max"
        >
          <span className="mono" style={{ fontSize: 12 }}>◰</span>
        </button>
        <button
          type="button"
          className="tb-btn"
          title={t('harness.term.close')}
          onClick={() => setTermOpen(false)}
          data-testid="harness-terminal-close"
        >
          <X size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="tp-body">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tp-pane"
            hidden={tab.id !== activeId}
            data-testid="harness-terminal-pane"
          >
            <div className="tp-term">
              <InteractiveTerminal key={tab.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
