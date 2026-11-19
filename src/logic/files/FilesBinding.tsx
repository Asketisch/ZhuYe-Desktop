import type { ComponentType } from 'react';
import { useFilesController } from './useFilesController';
import type { FilesViewProps } from '@/contracts/files';
export function FilesBinding({ view: View, FileTree, CodeMirrorEditor }: { view: ComponentType<FilesViewProps>; FileTree: FilesViewProps['FileTree']; CodeMirrorEditor: FilesViewProps['CodeMirrorEditor'] }) {
  const ctrl = useFilesController();
  return <View t={ctrl.t} ctrl={ctrl} FileTree={FileTree} CodeMirrorEditor={CodeMirrorEditor} />;
}
