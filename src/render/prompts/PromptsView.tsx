import { BookOpen, ChevronRight, Send } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import type { PromptsViewProps } from '@/contracts/knowledge/prompts';
import s from './PromptsView.module.css';

export function PromptsView({ prompts, selectedId, sentId, onToggle, onSend }: PromptsViewProps) {
  return (
    <PageShell icon={BookOpen} title="Prompts" subtitle="Send a template to the current chat. Custom prompts from ~/.zhuye/prompts/ coming later." width="md">
      <div className={s.list}>{prompts.map((p) => {
        const isOpen = selectedId === p.id;
        return (
          <Card key={p.id} level="outlined" padding="none" className={s.item} data-open={isOpen || undefined}>
            <button className={s.itemHeader} onClick={() => onToggle(p.id)}>
              <div className={s.itemBody}><div className={s.itemName}>{p.name}</div><div className={s.itemDesc}>{p.description}</div></div>
              <Icon icon={ChevronRight} size={14} className={s.chevron} />
            </button>
            {isOpen && (
              <div className={s.itemDetail}>
                <pre className={s.bodyPre}>{p.body}</pre>
                <Button variant={sentId === p.id ? 'secondary' : 'primary'} size="sm" onClick={() => onSend(p.id)} leftIcon={<Icon icon={Send} size={13} />}>{sentId === p.id ? 'Sent ✓' : 'Send to chat'}</Button>
              </div>
            )}
          </Card>
        );
      })}</div>
    </PageShell>
  );
}
