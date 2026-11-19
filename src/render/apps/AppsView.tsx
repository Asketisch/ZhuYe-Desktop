import { AppWindow } from 'lucide-react';
import type { AppsViewProps } from '@/contracts/basicPages';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';

export function AppsView({ t }: AppsViewProps) {
  return (
    <PageShell
      icon={AppWindow}
      title={t('apps.title')}
      subtitle={
        <>
          {t('apps.subtitle')} <Badge variant="info">coming soon</Badge>
        </>
      }
      width="md"
    >
      <Card level="flat" padding="none">
        <EmptyState
          size="lg"
          icon={<Icon icon={AppWindow} size={32} />}
          title={t('apps.comingSoonTitle')}
          description={t('apps.comingSoonDesc')}
        />
      </Card>
    </PageShell>
  );
}
