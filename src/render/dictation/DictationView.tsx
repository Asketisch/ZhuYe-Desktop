import { Mic, MicOff, Copy, ClipboardPaste, Trash2, AlertTriangle } from 'lucide-react';
import type { DictationViewProps } from '@/contracts/dictation';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import s from './DictationView.module.css';

export function DictationView({ t, isSupported, isListening, transcript, error, holdMode, copyOk,
  onToggleListen, onHoldModeChange, onHoldStart, onHoldEnd, onReset, onCopy, onInsert }: DictationViewProps) {
  return (
    <PageShell icon={Mic} title={t('dictation.title')} subtitle={<>{t('dictation.subtitle')} <Badge variant="info">{t('dictation.live')}</Badge></>} width="md">
      <Card level="flat" padding="lg" className={s.card}>
        {!isSupported ? <div className={s.empty}><Icon icon={MicOff} size={32} /><h3>{t('dictation.unavailable')}</h3><p>{t('dictation.unavailableDesc', { code: 'SpeechRecognition' })}</p><Badge variant="warning">{t('dictation.unavailableBadge')}</Badge></div> : <>
          <div className={s.row}><Button variant={isListening ? 'danger' : 'primary'} onClick={onToggleListen} aria-pressed={isListening} aria-label={isListening ? t('dictation.stopAria') : t('dictation.startAria')}><Icon icon={isListening ? MicOff : Mic} size={16} />{isListening ? t('dictation.stop') : t('dictation.start')}</Button>
            <label className={s.checkbox}><input type="checkbox" checked={holdMode} onChange={(event) => onHoldModeChange(event.target.checked)} /><span>{t('dictation.holdLabel')}</span></label></div>
          {holdMode && <div className={s.holdArea} onMouseDown={onHoldStart} onMouseUp={onHoldEnd} onMouseLeave={() => { if (isListening) onHoldEnd(); }} onTouchStart={onHoldStart} onTouchEnd={onHoldEnd} role="button" tabIndex={0} aria-label={t('dictation.holdAria')}>{isListening ? t('dictation.holdActive') : t('dictation.holdIdle')}</div>}
          <textarea className={s.transcript} rows={8} value={transcript} placeholder={isListening ? t('dictation.placeholderActive') : t('dictation.placeholderIdle')} readOnly aria-label={t('dictation.transcriptAria')} />
          {error && <div className={s.error} role="alert"><Icon icon={AlertTriangle} size={16} /><span>{error}</span></div>}
          <div className={s.actions}><Button variant="ghost" onClick={onReset} aria-label={t('dictation.clearAria')}><Icon icon={Trash2} size={16} />{t('dictation.clear')}</Button>
            <Button variant="ghost" onClick={onCopy} aria-label={t('dictation.copyAria')}><Icon icon={Copy} size={16} />{copyOk ? t('dictation.copied') : t('dictation.copy')}</Button>
            {onInsert && <Button variant="primary" onClick={() => onInsert(transcript)} disabled={!transcript}><Icon icon={ClipboardPaste} size={16} />{t('dictation.insert')}</Button>}</div>
        </>}
      </Card>
    </PageShell>
  );
}
