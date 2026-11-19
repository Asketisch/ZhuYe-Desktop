import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { onPtyExit, onPtyOutput, reflect_pty_close, reflect_pty_resize, reflect_pty_start, reflect_pty_write } from '@/utils/commands/terminal';
import styles from '@/render/terminal/InteractiveTerminal.module.css';

export function InteractiveTerminal() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const id = crypto.randomUUID();
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'monospace', fontSize: 13, convertEol: false });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let disposed = false;
    let started = false;
    let outputUnlisten: (() => void) | undefined;
    let exitUnlisten: (() => void) | undefined;
    let writes = Promise.resolve();
    const data = terminal.onData((value) => {
      writes = writes.then(() => reflect_pty_write(id, value)).catch((e) => { terminal.writeln(`\r\n${String(e)}`); });
    });
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      if (started) void reflect_pty_resize(id, terminal.cols, terminal.rows).catch(() => {});
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
        await reflect_pty_start(id, terminal.cols, terminal.rows);
        started = true;
        if (disposed) { await reflect_pty_close(id); return; }
        resize();
      } catch (e) {
        if (!disposed) terminal.writeln(`\r\n${String(e)}`);
      }
    })();
    return () => {
      disposed = true;
      observer.disconnect();
      data.dispose();
      outputUnlisten?.();
      exitUnlisten?.();
      if (started) void reflect_pty_close(id);
      terminal.dispose();
    };
  }, []);
  return <div className={styles.terminal} ref={container} data-testid="interactive-terminal" />;
}
