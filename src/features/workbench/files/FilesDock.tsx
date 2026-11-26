/**
 * FilesDock —— 右 dock「文件」面板入口（DockPanel 的 files 档）。
 *
 * 组合：逻辑（useFilesDockController）→ 展示（FilesDockView）。
 * 展示层按仓库分层约定不感知逻辑层类型，这里做一次显式的 props 映射；
 * 文案已全部在 controller 内翻译完成。
 */
import { useFilesDockController } from '@/logic/files/useFilesDockController';
import { FilesDockView } from '@/render/workbench/files/FilesDockView';

export function FilesDock() {
  const ctrl = useFilesDockController();
  return (
    <FilesDockView
      title={ctrl.title}
      subtitle={ctrl.subtitle}
      refreshLabel={ctrl.refreshLabel}
      toggleLabel={ctrl.toggleLabel}
      treeCollapsed={ctrl.treeCollapsed}
      treeHint={ctrl.treeHint}
      nodes={ctrl.tree}
      filters={ctrl.filters}
      activeFilter={ctrl.filter}
      selectedPath={ctrl.selectedPath}
      preview={ctrl.preview}
      onToggleTree={ctrl.toggleTree}
      onRefresh={ctrl.refresh}
      onFilterChange={ctrl.setFilter}
      onOpenFile={ctrl.selectFile}
      onToggleDir={ctrl.toggleDir}
    />
  );
}
