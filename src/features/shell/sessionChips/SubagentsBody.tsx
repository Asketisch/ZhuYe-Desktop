/**
 * SubagentsBody —— 会话内 chips「子代理」的内容体。
 *
 * 复用 store 的 `subagents.lastStatus`（children 快照）+ `feed`
 * （进度流尾部），提供刷新 / 逐 child 中断 / 跳检查器子代理档。
 * 无任何子代理活动时返回 null（chip 随之隐藏）。
 */
import { AlertOctagon, Bot, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Icon } from '@/features/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';
import s from '@/render/shell/SessionChips.module.css';

export function SubagentsBody() {
  const { t } = useI18n();
  const feed = useAgentStore((st) => st.subagents.feed);
  const lastStatus = useAgentStore((st) => st.subagents.lastStatus);
  const querySubagents = useAgentStore((st) => st.querySubagents);
  const interruptSubagent = useAgentStore((st) => st.interruptSubagent);
  const setDockMode = useShellUi((st) => st.setDockMode);
  const setDockOpen = useShellUi((st) => st.setDockOpen);

  if (feed.length === 0 && (lastStatus === null || lastStatus.length === 0)) return null;

  return (
    <div className={s.body} data-testid="corner-subagents-body">
      <div className={s.btnRow}>
        <button type="button" className={s.btn} onClick={() => void querySubagents().catch(() => {})} data-testid="corner-subagents-refresh">
          <Icon icon={RefreshCw} size={12} /> {t('harness.corner.subagents.refresh')}
        </button>
        <button
          type="button"
          className={s.btn}
          onClick={() => { setDockMode('agents'); setDockOpen(true); }}
          data-testid="corner-subagents-open"
        >
          {t('harness.corner.subagents.openAll')}
        </button>
      </div>
      {(lastStatus ?? []).length > 0 && (
        <ul className={s.childList} data-testid="corner-subagents-children">
          {(lastStatus ?? []).map((child) => (
            <li key={child.child_id} className={s.childRow} data-state={child.state}>
              <span className={s.childName} title={child.child_id}>
                {child.role || child.child_id.slice(0, 8)}
              </span>
              {child.current_tool && <span className={s.childTool}>{child.current_tool}</span>}
              <Badge variant={child.state === 'running' ? 'accent' : child.state === 'failed' ? 'danger' : 'neutral'}>
                {child.state}
              </Badge>
              {child.state === 'running' && (
                <button
                  type="button"
                  className={`${s.btn} ${s.btnDanger}`}
                  onClick={() => void interruptSubagent(child.child_id).catch(() => {})}
                  data-testid={`corner-subagents-interrupt-${child.child_id}`}
                >
                  <Icon icon={AlertOctagon} size={11} /> {t('harness.corner.subagents.interrupt')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ul className={s.feedList} data-testid="corner-subagents-feed">
        {feed.slice(-8).reverse().map((entry) => (
          <li key={entry.id} className={s.feedRow} title={entry.text}>
            {entry.kind === 'tool_begin' || entry.kind === 'tool_end' ? (
              <Loader2 size={10} className={s.spin} />
            ) : (
              <span className={s.feedRole}>{entry.role}</span>
            )}
            <span className={s.feedText}>{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 运行中的子代理数量（chip 徽标用；无活动时 0）。 */
export function useRunningSubagentCount(): number {
  const lastStatus = useAgentStore((st) => st.subagents.lastStatus);
  const feed = useAgentStore((st) => st.subagents.feed);
  if (feed.length === 0 && (lastStatus === null || lastStatus.length === 0)) return 0;
  const running = (lastStatus ?? []).filter((c) => c.state === 'running');
  return running.length > 0 ? running.length : (lastStatus ?? []).length;
}

/** 子代理 chip 的图标（与内容体同源）。 */
export const SUBAGENTS_ICON = Bot;
