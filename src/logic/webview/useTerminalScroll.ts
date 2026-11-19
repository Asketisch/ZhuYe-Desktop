import { useEffect, useRef } from 'react';
import type { TerminalLine } from '@/contracts/terminal';

export function useTerminalScroll(lines: TerminalLine[], activeId: string | null) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines, activeId]);
  return bottomRef;
}
