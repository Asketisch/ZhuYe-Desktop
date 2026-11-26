import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { FilesController } from '@/logic/files/useFilesController';
import type { FileTreeProps } from '@/features/workbench/files/FileTree';
import type { CodeMirrorEditorProps } from '@/features/workbench/files/CodeMirrorEditor';

export interface FilesViewProps {
  t: I18nContextValue['t'];
  ctrl: FilesController;
  FileTree: ComponentType<FileTreeProps>;
  CodeMirrorEditor: ComponentType<CodeMirrorEditorProps>;
}
