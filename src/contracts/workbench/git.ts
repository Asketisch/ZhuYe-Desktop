import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { GitController } from '@/logic/workbench/git/useGitController';
export interface GitViewProps { t: I18nContextValue['t']; ctrl: GitController; WorktreePanel: ComponentType; DiffViewer: ComponentType<{ diff: string; emptyMessage?: string }> }
