/**
 * Apps —— App 集成视图。
 *
 * v1.11 D10 收口：此前是硬编码的 sample 数据（假 VS Code / JetBrains 条目,
 * 假 connect/disconnect 开关），用户会误以为可用功能。现改为与 MobileView
 * 同口径的 coming soon 占位 —— 真实语义是「插件运行时里的应用集成」
 * （对标 MiniMax 的 Mini App：agent 可创建/发布自定义小应用），等插件
 * 运行时打通后接线（见 gap-report D10）。
 */
import { AppWindow } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, EmptyState } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';

export function AppsView() {
  const { t } = useI18n();
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
