import { useRenderView } from '@/logic/renderer/useRenderView';
import { FilesBinding } from '@/logic/files/FilesBinding';
import { FilesView as DefaultView } from '@/render/workbench/files/FilesView';
import { FileTree } from './FileTree';
import { CodeMirrorEditor } from './CodeMirrorEditor';

export { lspPrefKey, readLspPref } from '@/logic/files/useFilesController';

export function FilesView() {
  const View = useRenderView('FilesView', DefaultView);
  return <FilesBinding view={View} FileTree={FileTree} CodeMirrorEditor={CodeMirrorEditor} />;
}
