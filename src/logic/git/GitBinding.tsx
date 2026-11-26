import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useGitController } from './useGitController';
import type { GitViewProps } from '@/contracts/workbench/git';
export function GitBinding({ view: View, WorktreePanel, DiffViewer }: { view: ComponentType<GitViewProps>; WorktreePanel: ComponentType; DiffViewer: GitViewProps['DiffViewer'] }) {
  const { t } = useI18n(); const ctrl = useGitController(t);
  return <View t={t} ctrl={ctrl} WorktreePanel={WorktreePanel} DiffViewer={DiffViewer} />;
}
