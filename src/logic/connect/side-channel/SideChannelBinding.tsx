/**
 * SideChannel 绑定——控制器/查询/动作转发给可替换视图。
 */
import type { ComponentType } from 'react';
import type { SideChannelViewProps } from '@/contracts/conversation/sideChannel';
import { useI18n } from '@/utils/i18n';
import { useSideChannelController } from '@/logic/connect/side-channel/useSideChannelController';
import type { SideChannelStatus } from '@/contracts/conversation/sideChannel';
import type { SideChannelStatusVariant } from '@/contracts/conversation/sideChannel';

const STATUS_VARIANT: Record<SideChannelStatus, SideChannelStatusVariant> = {
  running: 'accent',
  done: 'success',
  cancelled: 'neutral',
  error: 'danger',
};

export function SideChannelBinding({ view: View }: { view: ComponentType<SideChannelViewProps> }) {
  const ctrl = useSideChannelController();
  const { t } = useI18n();
  return (
    <View
      t={t}
      iconName="git-branch"
      title={t('sideChannel.title')}
      subtitle={t('sideChannel.subtitle')}
      width="lg"
      runningCount={ctrl.runningCount}
      loading={ctrl.loading}
      error={ctrl.error}
      channels={ctrl.channels}
      showForm={ctrl.showForm}
      agentName={ctrl.agentName}
      prompt={ctrl.prompt}
      isMutating={ctrl.isMutating}
      statusVariant={(status) => STATUS_VARIANT[status]}
      onStartSubmit={() => void ctrl.start()}
      onAgentNameChange={ctrl.setAgentName}
      onPromptChange={ctrl.setPrompt}
      onToggleForm={ctrl.toggleShowForm}
      onCancel={(id) => void ctrl.cancel(id)}
      labels={{
        runningCount: (count) => t('sideChannel.runningCount', { count }),
        unavailable: t('sideChannel.unavailable'),
        start: t('sideChannel.start'),
        cancel: t('common.cancel'),
        agentNamePlaceholder: t('sideChannel.agentNamePlaceholder'),
        promptPlaceholder: t('sideChannel.promptPlaceholder'),
        startOne: t('sideChannel.startOne'),
        failed: t('sideChannel.failed'),
        failedDesc: t('sideChannel.failedDesc'),
        empty: t('sideChannel.empty'),
        emptyDesc: t('sideChannel.emptyDesc'),
      }}
    />
  );
}
