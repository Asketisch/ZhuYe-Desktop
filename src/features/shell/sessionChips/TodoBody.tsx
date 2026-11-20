/**
 * TodoBody —— 会话内 chips「任务清单」的内容体。
 *
 * 数据来自 `TodoWrite` 工具写入的 `store.todos`（reducer 在每次
 * `tool_call_end` 时整体覆盖），本组件纯订阅渲染。
 *
 * 归属：composer 上方的会话内 chips 行（见 `session/SessionDock.tsx`）。
 * 此前同样的内容挂在窗口右上角的 fixed 浮层（CornerStack）。
 */
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import s from '@/render/shell/SessionChips.module.css';

export function TodoBody() {
  const todos = useAgentStore((st) => st.todos);
  if (todos.length === 0) return null;

  const active = todos.find((x) => x.status === 'in_progress');

  return (
    <div className={s.body} data-testid="corner-todo-body">
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
    </div>
  );
}
