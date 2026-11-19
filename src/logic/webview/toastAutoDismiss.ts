import { useEffect } from 'react';

/** Toast 的自动消失计时器由 WebView 生命周期层持有。 */
export function useToastAutoDismiss(onDismiss: () => void, durationMs = 4000): void {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);
}
