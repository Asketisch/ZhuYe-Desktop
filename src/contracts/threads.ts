import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { SessionBucket } from '@/features/sessions';
import type { ReflectSessionInfo } from '@/utils/commands';
import type { ThreadBucketGroupProps } from '@/features/threads/components/ThreadBucketGroup';

export interface ThreadsViewProps {
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  buckets: SessionBucket[];
  archived: ReflectSessionInfo[];
  activeId: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  onEnterSelect: () => void;
  onExitSelect: () => void;
  onDeleteSelected: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<string | null>;
  onFork: (id: string, branch: string) => Promise<string>;
  onArchive: (id: string) => Promise<void>;
  onGenerateTitle: (id: string) => Promise<string>;
  onToggleSelect: (id: string) => void;
  onUnarchive: (id: string) => Promise<void>;
  onDeleteArchived: (id: string) => Promise<void>;
  BucketGroup: ComponentType<ThreadBucketGroupProps>;
}
