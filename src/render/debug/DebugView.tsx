import { Bug, Activity, Database } from 'lucide-react';
import type { DebugViewProps } from '@/contracts/harness/basicPages';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import s from './DebugView.module.css';

export function DebugView({ stateJson, events }: DebugViewProps) {
  return (
    <PageShell
      icon={Bug}
      title="Debug"
      subtitle={
        <>
          Dev-only diagnostic panel. <Badge variant="warning">remove in production</Badge>
        </>
      }
      width="lg"
    >
      <section className={s.section}>
        <h3 className={s.sectionTitle}>
          <Icon icon={Database} size={14} />
          Agent state
        </h3>
        <pre className={s.jsonBlock}>
          {stateJson}
        </pre>
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>
          <Icon icon={Activity} size={14} />
          Event log
        </h3>
        <div className={s.eventLog}>
          {events.map((e, i) => (
            <div key={i} className={s.eventLine}>{e}</div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
