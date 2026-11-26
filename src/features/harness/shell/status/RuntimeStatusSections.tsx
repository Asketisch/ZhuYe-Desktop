/**
 * Inspector 的运行时状态分区 —— 已完成的子代理调用。
 *
 * 基座能力有、GUI 此前看不到:
 * - **已完成的子代理调用**:core 的 `SubagentRegistry` 记着每次子代理
 *   委派的任务摘要 / 结果摘要 —— 压缩后「刚才派了哪些、结论是什么」就
 *   靠它回答。
 *
 * 凭据池健康度不再在右侧展示（设置页「模型组」仍保留健康点）。
 */
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle } from 'lucide-react';
import { Badge, Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_recovery_state } from '@/utils/commands/harness/runtimeStatus';
import s from '@/render/harness/shell/Inspector.module.css';

/** 已完成的子代理调用(核心 registry 快照)。 */
export function SubagentCallsSection() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['recovery-state'],
    queryFn: () => zhuye_recovery_state(),
    staleTime: 15_000,
  });
  const calls = q.data ?? [];
  if (calls.length === 0) return null;

  return (
    <section className={s.section} data-testid="inspector-subagent-calls">
      <h3 className={s.sectionTitle}>
        <Icon icon={Bot} size={14} />
        {t('inspector.subagentCalls')}
        <Badge variant="neutral">{calls.length}</Badge>
      </h3>
      <ul className={s.list}>
        {calls.map((c, i) => (
          <li
            key={`${c.toolName}-${c.iteration}-${i}`}
            className={s.row}
            title={`${c.taskSummary}\n${c.resultSummary}`}
          >
            <span className={s.name}>{c.toolName}</span>
            <span className={s.value}>{c.taskSummary || c.resultSummary}</span>
            <Icon icon={CheckCircle} size={11} />
          </li>
        ))}
      </ul>
    </section>
  );
}
