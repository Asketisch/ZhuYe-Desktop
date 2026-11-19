import type { MobileViewProps } from '@/contracts/mobile';
import { Smartphone } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';

export function MobileView(_props: MobileViewProps) {
  return (
    <PageShell icon={Smartphone} title="Mobile" subtitle={<><span>Mobile companion view with touch-optimized layout.</span> <Badge variant="info">coming soon</Badge></>} width="md">
      <Card level="flat" padding="none">
        <EmptyState size="lg" icon={<Icon icon={Smartphone} size={32} />} title="Mobile companion coming soon" description="Pair with the desktop app from your phone — responsive layout, touch gestures, and push notifications." />
      </Card>
    </PageShell>
  );
}
