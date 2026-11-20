/**
 * CornerStack —— 主窗口右上角交互栈。
 *
 * 纵向堆叠四个常驻组件：任务清单 / 目标 / 子代理 / 建议。fixed 定位
 * 在标题条下方右上（z-30，低于命令面板 z-60 与任务中心 z-120）。各
 * 组件自行决定是否渲染（内容无关则隐藏），折叠互不影响。
 */
import { GoalWidget } from './GoalWidget';
import { SubagentsWidget } from './SubagentsWidget';
import { SuggestionsWidget } from './SuggestionsWidget';
import { TodoWidget } from './TodoWidget';
import s from '@/render/shell/CornerWidgets.module.css';

export function CornerStack() {
  return (
    <div className={s.stack} data-testid="corner-stack">
      <TodoWidget />
      <GoalWidget />
      <SubagentsWidget />
      <SuggestionsWidget />
    </div>
  );
}
