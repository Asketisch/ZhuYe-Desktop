/**
 * Inspector 的运行时状态分区 —— 凭证池健康度 + 已完成的子代理调用。
 *
 * 两者基座都有、GUI 此前看不到:
 * - **凭证池健康度**:failover 发生了,却看不出池里还剩几个能用、哪些在
 *   冷却(核心的 cooldown 集合是私有的,只能从健康集合反推)。
 * - **已完成的子代理调用**:core 的 `SubagentRegistry` 记着每次子代理
 *   委派的任务摘要 / 结果摘要 —— 压缩后「刚才派了哪些、结论是什么」就
 *   靠它回答。
 */
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Bot, CheckCircle } from 'lucide-react';
import { Badge, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_credential_pool_status,
  reflect_recovery_state,
} from '@/utils/commands/runtimeStatus';
import s from './Inspector.module.css';

/** 凭证池健康度:总数 / 健康数 / 冷却中。 */
export function CredentialPoolSection() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['credential-pool-status'],
    queryFn: () => reflect_credential_pool_status(),
    staleTime: 15_000,
  });
  const pools = q.data ?? [];
  if (pools.length === 0) return null;

  return (
    <section className={s.section} data-testid="inspector-credential-pool">
      <h3 className={s.sectionTitle}>
        <Icon icon={ShieldAlert} size={14} />
        {t('inspector.credentialPool')}
      </h3>
      <ul className={s.list}>
        {pools.map((p) => {
          const cooling = p.total - p.healthy;
          return (
            <li key={p.provider} className={s.row}>
              <span className={s.name}>{p.provider}</span>
              <span className={s.value}>
                {p.healthy} / {p.total}
              </span>
              {cooling > 0 ? (
                <Badge variant="warning">
                  {t('inspector.credentialPoolCooling', { count: String(cooling) })}
                </Badge>
              ) : (
                <Badge variant="success">{t('inspector.credentialPoolOk')}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 已完成的子代理调用(核心 registry 快照)。 */
export function SubagentCallsSection() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['recovery-state'],
    queryFn: () => reflect_recovery_state(),
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
