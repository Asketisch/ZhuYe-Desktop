/**
 * TodoWidget —— 右上角任务清单（来自 `TodoWrite` 工具的 `store.todos`）。
 *
 * 事件驱动实时刷新：reducer 在每次 `tool_call_end` 时整体覆盖
 * `store.todos`，本组件纯订阅渲染。无清单时整体隐藏。
 */
import { CheckCircle2, Circle, ListChecks, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { CornerWidget } from './CornerWidget';
import s from '@/render/shell/CornerWidgets.module.css';

export function TodoWidget() {
  const { t } = useI18n();
  const todos = useAgentStore((st) => st.todos);
  if (todos.length === 0) return null;

  const done = todos.filter((x) => x.status === 'completed').length;
  const active = todos.find((x) => x.status === 'in_progress');

  return (
    <CornerWidget
      testId="todo"
      icon={<ListChecks size={13} />}
      label={t('harness.corner.todo.title')}
      badge={`${done}/${todos.length}`}
      defaultOpen
    >
      {active && (
        <div className={s.todoActive} data-testid="corner-todo-active">
          <Loader2 size={12} className={s.spin} />
          <span>{active.active_form ?? active.content}</span>
        </div>
      )}
      <ul className={s.todoList}>
        {todos.map((todo, i) => (
          <li key={`${todo.content}-${i}`} className={s.todoRow} data-status={todo.status}>
            {todo.status === 'completed' ? (
              <CheckCircle2 size={13} className={s.doneIcon} />
            ) : todo.status === 'in_progress' ? (
              <Loader2 size={13} className={`${s.runIcon} ${s.spin}`} />
            ) : (
              <Circle size={13} className={s.pendingIcon} />
            )}
            <span className={s.todoText} title={todo.active_form ?? undefined}>
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </CornerWidget>
  );
}
