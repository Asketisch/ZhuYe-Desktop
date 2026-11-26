import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import s from '@/render/messages/MessageList.module.css';

export function CopyButton({ text, testId }: { text: string; testId: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return <button type="button" className={s.copyBtn} onClick={onCopy} title={t('chat.copyMessage')} aria-label={t('chat.copyMessage')} data-testid={testId}>
    <Icon icon={copied ? Check : Copy} size={12} />
  </button>;
}
