import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { onPtyExit, onPtyOutput, zhuye_pty_close, zhuye_pty_resize, zhuye_pty_start, zhuye_pty_write } from '@/utils/commands/terminal';
import { subscribeTheme } from '@/logic/preferences/theme';
import styles from '@/render/terminal/InteractiveTerminal.module.css';

/**
 * 终端配色取自 tokens.css：xterm 需要具体色值（canvas 与 DOM 渲染器都要解析），
 * 不能直接写 var()，故从 <html> 的计算样式里读。ANSI 16 色保持 xterm 默认。
 * 读不到的键（极端时序 / 非 DOM 环境）一律剔除，交给 xterm 的内置默认值。
 */
function readTerminalTheme(): ITheme {
  if (typeof document === 'undefined') return {};
  const computed = getComputedStyle(document.documentElement);
  const token = (name: string): string | undefined => computed.getPropertyValue(name).trim() || undefined;
  return Object.fromEntries(
    Object.entries({
      background: token('--term-bg'),
      foreground: token('--term-fg'),
      cursor: token('--fg'),
      cursorAccent: token('--term-bg'),
      selectionBackground: token('--accent-border'),
    }).filter(([, value]) => value !== undefined),
  );
}

export function InteractiveTerminal() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const id = crypto.randomUUID();
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 13,
      convertEol: false,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // 主题切换（含跟随系统）后重读 token：终端底色与前景跟随明暗。
    const unsubscribeTheme = subscribeTheme(() => {
      terminal.options.theme = readTerminalTheme();
    });
    let disposed = false;
    let started = false;
    let outputUnlisten: (() => void) | undefined;
    let exitUnlisten: (() => void) | undefined;
    let writes = Promise.resolve();
    const data = terminal.onData((value) => {
      writes = writes.then(() => zhuye_pty_write(id, value)).catch((e) => { terminal.writeln(`\r\n${String(e)}`); });
    });
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      if (started) void zhuye_pty_resize(id, terminal.cols, terminal.rows).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    void (async () => {
      try {
        outputUnlisten = await onPtyOutput((event) => { if (event.id === id && !disposed) terminal.write(new Uint8Array(event.data)); });
        if (disposed) { outputUnlisten(); return; }
        exitUnlisten = await onPtyExit((eventId) => { if (eventId === id && !disposed) terminal.writeln('\r\n[Process exited]'); });
        if (disposed) { exitUnlisten(); return; }
        resize();
        await zhuye_pty_start(id, terminal.cols, terminal.rows);
        started = true;
        if (disposed) { await zhuye_pty_close(id); return; }
        resize();
      } catch (e) {
        if (!disposed) terminal.writeln(`\r\n${String(e)}`);
      }
    })();
    return () => {
      disposed = true;
      observer.disconnect();
      unsubscribeTheme();
      data.dispose();
      outputUnlisten?.();
      exitUnlisten?.();
      if (started) void zhuye_pty_close(id);
      terminal.dispose();
    };
  }, []);
  return <div className={styles.terminal} ref={container} data-testid="interactive-terminal" />;
}
