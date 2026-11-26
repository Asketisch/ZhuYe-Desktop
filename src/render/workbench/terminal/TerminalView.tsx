import { Terminal as TerminalIcon, CornerDownLeft, Square, Trash2 } from 'lucide-react';
import type { TerminalViewProps } from '@/contracts/workbench/terminal';
import s from './TerminalView.module.css';

export function TerminalView({ state, activeLines, activeSession, bottomRef, t, tp,
  onSelectSession, onInputChange, onSubmit, onKill, onClear }: TerminalViewProps) {
  return (
    <div className={s.root} data-testid="terminal-root">
      <div className={s.header}>
        <TerminalIcon width={14} height={14} strokeWidth={1.75} aria-hidden="true" role="presentation" />
        <span>{t('terminal.title')}</span>
        <span className={s.spacer} />
        {state.sessions.length > 0 && (
          <span className={s.sessionCount}>
            {tp('terminal.sessionCount', state.sessions.length, { count: state.sessions.length })}
          </span>
        )}
      </div>

      {state.sessions.length > 0 && (
        <div className={s.tabs} role="tablist" aria-label={t('terminal.sessionsAria')}>
          {state.sessions.map((sess) => (
            <button
              key={sess.id}
              role="tab"
              type="button"
              aria-selected={sess.id === state.activeId}
              className={s.tab}
              data-active={sess.id === state.activeId}
              data-status={sess.status}
              onClick={() => onSelectSession(sess.id)}
            >
              <span className={s.tabTitle}>
                {sess.command.length > 22 ? sess.command.slice(0, 22) + '…' : sess.command}
              </span>
              <span className={s.tabStatus}>{sess.status}</span>
            </button>
          ))}
        </div>
      )}

      <div className={s.screen} role="log" aria-label={t('terminal.outputAria')} aria-live="polite">
        {state.sessions.length === 0 ? (
          <div className={s.emptyWrap}>
            <p className={s.emptyTitle}>{t('terminal.empty.title')}</p>
            <p className={s.emptyHint}>{t('terminal.empty.hint')}</p>
          </div>
        ) : (
          activeLines.map((line) => (
            <div key={line.seq} className={s.line} data-stream={line.stream}>
              {line.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className={s.toolbar}>
        {activeSession && activeSession.status === 'running' && (
          <button
            type="button"
            className={s.killBtn}
            onClick={onKill}
            data-testid="terminal-kill"
            aria-label={t('terminal.kill')}
          >
            <Square width={12} height={12} strokeWidth={1.75} aria-hidden="true" role="presentation" /> {t('terminal.kill')}
          </button>
        )}
        {activeSession && (
          <button
            type="button"
            className={s.clearBtn}
            onClick={onClear}
            data-testid="terminal-clear"
            aria-label={t('terminal.clear')}
          >
            <Trash2 width={12} height={12} strokeWidth={1.75} aria-hidden="true" role="presentation" /> {t('terminal.clear')}
          </button>
        )}
        {activeSession && (
          <span className={s.sessionMeta} data-testid="terminal-meta">
            {activeSession.status}
            {activeSession.exitCode !== undefined ? ` · ${t('terminal.exit')} ${activeSession.exitCode}` : ''}
            {' · '}{t('terminal.cwd')} {activeSession.cwd}
          </span>
        )}
      </div>

      <form className={s.form} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <span className={s.prompt}>$</span>
        <input
          value={state.input}
          onChange={(e) => onInputChange(e.target.value)}
          className={s.input}
          placeholder="echo hello"
          autoFocus
          disabled={state.busy}
          data-testid="terminal-input"
        />
        <CornerDownLeft width={12} height={12} strokeWidth={1.75} aria-hidden="true" role="presentation" className={s.enterHint} />
      </form>
    </div>
  );
}
