import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useI18n } from '@/utils/i18n';
import { useUiPrefs } from '@/logic/preferences/uiPrefs';
import type { ActivityBarProps } from '@/contracts/harness/activityBar';
export function ActivityBarBinding({ view: View }: { view: ComponentType<ActivityBarProps> }) {
  const router = useRouter(); const location = useLocation(); const { t } = useI18n();
  const [prefs] = useUiPrefs(); const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onMouseDown = (event: MouseEvent) => { if (!moreWrapRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onMouseDown); document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [moreOpen]);
  return <View t={t} pathname={location.pathname} simple={prefs.activityBarMode !== 'full'} moreOpen={moreOpen}
    moreWrapRef={moreWrapRef} onToggleMore={() => setMoreOpen((open) => !open)}
    onNavigate={(to) => { setMoreOpen(false); void router.navigate({ to }); }} />;
}
