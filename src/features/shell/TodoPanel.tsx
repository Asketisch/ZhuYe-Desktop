/**
 * TodoPanel —— agent 的 todo 清单(来自 `TodoWrite` 工具)。
 *
 * 核心的 `TodoWrite` 把清单放进 `ToolOutput.metadata.todos`,事件流里就
 * 有 —— GUI 直接从 `tool_call_end` 事件里取（store 的 `todos`）。
 *
 * 注:**基座侧没有消费方** —— 清单没回灌模型上下文,LLM 实际上看不到
 * 自己的 todo 清单(核心注释指向的 reducer 在 submodule 里并不存在)。
 * GUI 如实展示 agent 写了什么,便于用户核对「agent 以为自己在做什么」。
 */
import { ListChecks } from 'lucide-react';
import { Badge, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import s from './Inspector.module.css';

const STATUS_VARIANT: Record<string, 'neutral' | 'accent' | 'success'> = {
  pending: 'neutral',
  in_progress: 'accent',
  completed: 'success',
};

export function TodoPanel() {
  const { t } = useI18n();
  const todos = useAgentStore((st) => st.todos);
  if (todos.length === 0) return null;

  const done = todos.filter((x) => x.status === 'completed').length;

  return (
    <section className={s.section} data-testid="inspector-todos">
      <h3 className={s.sectionTitle}>
        <Icon icon={ListChecks} size={14} />
        {t('inspector.todoList')}
        <Badge variant="neutral">
          {done} / {todos.length}
        </Badge>
      </h3>
      <ul className={s.list}>
        {todos.map((todo, i) => (
          <li key={`${todo.content}-${i}`} className={s.todoRow} data-status={todo.status}>
            <span className={s.todoText} title={todo.active_form ?? undefined}>
              {todo.content}
            </span>
            <Badge variant={STATUS_VARIANT[todo.status] ?? 'neutral'}>{todo.status}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
