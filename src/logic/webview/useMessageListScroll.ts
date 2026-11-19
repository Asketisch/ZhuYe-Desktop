import { useEffect, useRef } from 'react';
import type { Turn } from '@/stores/agent/types';

const NEAR_BOTTOM_PX = 64;

export function useMessageListScroll(turns: readonly Turn[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < NEAR_BOTTOM_PX) element.scrollTop = element.scrollHeight;
  }, [turns]);
  return ref;
}
