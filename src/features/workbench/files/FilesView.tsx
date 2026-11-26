import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { FilesBinding } from '@/logic/workbench/files/FilesBinding';
import { FilesView as DefaultView } from '@/render/workbench/files/FilesView';
import { FileTree } from './FileTree';
import { CodeMirrorEditor } from './CodeMirrorEditor';

export { lspPrefKey, readLspPref } from '@/logic/workbench/files/useFilesController';

export function FilesView() {
  const View = useRenderView('FilesView', DefaultView);
  return <FilesBinding view={View} FileTree={FileTree} CodeMirrorEditor={CodeMirrorEditor} />;
}
