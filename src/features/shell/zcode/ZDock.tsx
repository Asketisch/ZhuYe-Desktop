/**
 * ZDock —— composer 上方的会话内 chips 行。
 *
 * v3 起把原先挂在**窗口右上角**的 fixed 浮层（CornerStack）并入本行：
 * 四块内容 —— 任务清单 / 目标 / 子代理 / 建议 —— 与排队消息同处一行，
 * 因此只随会话出现，不再在所有路由右上角飘浮。
 *
 * 每块一个 chip + 弹层（同一时刻只开一个）：
 *   任务 —— agent TodoWrite 的清单（pending/进行中/完成三态 + 进度条）；
 *   目标 —— goal 模式快照（goalSnapshot.objective）+ 空闲时的设目标表单；
 *   子代理 —— 运行中的 child 快照与进度流尾部；
 *   建议 —— 首页 Hero 的快捷 prompt（预填 composer，不自动发送）；
 *   排队 —— 前端跟进消息队列（移除/立即发送，走 store 既有 action）。
 *
 * 内容体在 `features/shell/sessionChips/`；数据全部来自既有 store，
 * 不新增 IPC。
 */
import { useEffect, useRef, useState } from 'react';
import { CheckSquare, List, ListChecks, Loader2, Send, Target, X, Lightbulb, Bot } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, selectQueuedForActiveSession } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { TodoBody } from '@/features/shell/sessionChips/TodoBody';
import { GoalBody, goalStatusLabel } from '@/features/shell/sessionChips/GoalBody';
import { SubagentsBody } from '@/features/shell/sessionChips/SubagentsBody';
import { SuggestionsBody } from '@/features/shell/sessionChips/SuggestionsBody';
import s from '@/render/shell/zcode/zcode.module.css';

/** 可展开的 chips（同一时刻只开一个）。 */
type PopKind = 'todo' | 'goal' | 'subagents' | 'suggestions' | 'queue';

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);
  return ref;
}

export function ZDock({
  goalActive,
  goalText,
  turnRunning,
}: {
  goalActive: boolean;
  goalText: string;
  turnRunning: boolean;
}) {
  const { t } = useI18n();
  const todos = useAgentStore((st) => st.todos);
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const subagentsFeed = useAgentStore((st) => st.subagents.feed);
  const subagentsStatus = useAgentStore((st) => st.subagents.lastStatus);
  // v1.x 后台持续运行:只展示当前前台会话的队列。
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  const removeQueued = useAgentStore((st) => st.removeQueued);
  const drainQueue = useAgentStore((st) => st.drainQueue);

  const [openPop, setOpenPop] = useState<PopKind | null>(null);
  const todoRef = useOutsideClose(() => setOpenPop((v) => (v === 'todo' ? null : v)));
  const goalRef = useOutsideClose(() => setOpenPop((v) => (v === 'goal' ? null : v)));
  const subagentsRef = useOutsideClose(() => setOpenPop((v) => (v === 'subagents' ? null : v)));
  const suggestionsRef = useOutsideClose(() => setOpenPop((v) => (v === 'suggestions' ? null : v)));
  const queueRef = useOutsideClose(() => setOpenPop((v) => (v === 'queue' ? null : v)));

  const doneCount = todos.filter((td) => td.status === 'completed').length;
  const donePct = todos.length === 0 ? 0 : Math.round((doneCount / todos.length) * 100);
  const inProgress = todos.find((td) => td.status === 'in_progress');

  // 子代理：无任何活动时不显示该 chip。
  const hasSubagents = subagentsFeed.length > 0 || (subagentsStatus ?? []).length > 0;
  const runningSubagents = (subagentsStatus ?? []).filter((c) => c.state === 'running');
  const subagentsBadge = runningSubagents.length > 0
    ? `${runningSubagents.length}`
    : `${(subagentsStatus ?? []).length}`;

  return (
    <div className={s.dock} data-testid="zcode-dock">
      {/* ===== 任务清单 ===== */}
      {todos.length > 0 && (
        <span className={s.anch} ref={todoRef}>
          <button
            type="button"
            className={s.chip}
            data-testid="zcode-dock-todo"
            aria-expanded={openPop === 'todo'}
            onClick={() => setOpenPop((v) => (v === 'todo' ? null : 'todo'))}
          >
            <CheckSquare size={13} />
            <span className={s.chipTxt}>
              {t('harness.corner.todo.title')} {doneCount}/{todos.length}
            </span>
            <span className={s.planbar}>
              <i style={{ width: `${donePct}%` }} />
            </span>
            {inProgress && (
              <span className={s.chipTxt} style={{ maxWidth: 220 }}>
                {inProgress.active_form ?? inProgress.content}
              </span>
            )}
          </button>
          {openPop === 'todo' && (
            <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 300, display: 'block' }}>
              <TodoBody />
            </span>
          )}
        </span>
      )}

      {/* ===== 目标 ===== */}
      <span className={s.anch} ref={goalRef}>
        <button
          type="button"
          className={`${s.chip} ${s.goalChip}`}
          data-testid="zcode-dock-goal"
          aria-expanded={openPop === 'goal'}
          onClick={() => setOpenPop((v) => (v === 'goal' ? null : 'goal'))}
        >
          <Target size={13} />
          <span className={s.chipTxt} style={{ color: 'var(--accent)', fontWeight: 500 }}>
            {t('harness.corner.goal.title')}
          </span>
          {goalActive ? (
            <span className={s.chipTxt} style={{ maxWidth: 260 }}>
              {goalText || goalStatusLabel(t, goalSnapshot?.status)}
            </span>
          ) : (
            <span className={s.chipTxt}>{t('harness.corner.goal.setIdle')}</span>
          )}
        </button>
        {openPop === 'goal' && (
          <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 320, display: 'block' }}>
            <GoalBody />
          </span>
        )}
      </span>

      {/* ===== 子代理 ===== */}
      {hasSubagents && (
        <span className={s.anch} ref={subagentsRef}>
          <button
            type="button"
            className={s.chip}
            data-testid="zcode-dock-subagents"
            aria-expanded={openPop === 'subagents'}
            onClick={() => setOpenPop((v) => (v === 'subagents' ? null : 'subagents'))}
          >
            <Bot size={13} />
            <span className={s.chipTxt}>{t('harness.corner.subagents.title')}</span>
            <span className={s.chipTxt}>{subagentsBadge}</span>
          </button>
          {openPop === 'subagents' && (
            <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 320, display: 'block' }}>
              <SubagentsBody />
            </span>
          )}
        </span>
      )}

      {/* ===== 建议 ===== */}
      <span className={s.anch} ref={suggestionsRef}>
        <button
          type="button"
          className={s.chip}
          data-testid="zcode-dock-suggestions"
          aria-expanded={openPop === 'suggestions'}
          onClick={() => setOpenPop((v) => (v === 'suggestions' ? null : 'suggestions'))}
        >
          <Lightbulb size={13} />
          <span className={s.chipTxt}>{t('harness.corner.suggestions.title')}</span>
        </button>
        {openPop === 'suggestions' && (
          <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 300, display: 'block' }}>
            <SuggestionsBody />
          </span>
        )}
      </span>

      {/* ===== 排队 ===== */}
      {queued.length > 0 && (
        <span className={s.anch} ref={queueRef}>
          <button
            type="button"
            className={s.chip}
            data-testid="zcode-dock-queue"
            aria-expanded={openPop === 'queue'}
            onClick={() => setOpenPop((v) => (v === 'queue' ? null : 'queue'))}
          >
            <List size={13} />
            <span className={s.chipTxt}>{t('zcode.dock.queue')} {queued.length}</span>
          </button>
          {openPop === 'queue' && (
            <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 360, display: 'block', right: 0, left: 'auto' }}>
              <span className={s.popHead} style={{ display: 'flex' }}>
                <List size={12} /> {t('zcode.dock.queue')}({queued.length})
              </span>
              <span style={{ display: 'block' }}>
                {queued.map((qm, i) => (
                  <span key={qm.id} className={s.qrow} style={{ display: 'flex' }}>
                    <span className={s.zyQno ?? ''}>{i + 1}</span>
                    <span className={s.zyQtxt ?? ''}>{qm.text}</span>
                    <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
                      <button
                        type="button"
                        className={s.popRow}
                        style={{ width: 'auto', padding: '2px 6px' }}
                        title={t('zcode.dock.remove')}
                        aria-label={t('zcode.dock.remove')}
                        onClick={() => removeQueued(qm.id)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </span>
                ))}
              </span>
              <span className={s.popHead} style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)' }}>
                {turnRunning ? (
                  <><Loader2 size={12} className={s.zySpin ?? ''} /> {t('zcode.dock.queueRunning')}</>
                ) : (
                  <button
                    type="button"
                    className={s.popRow}
                    style={{ color: 'var(--accent)', width: 'auto' }}
                    onClick={() => { void drainQueue(); setOpenPop(null); }}
                  >
                    <Send size={12} /> {t('zcode.dock.sendNow')}
                  </button>
                )}
              </span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// 任务 chip 的图标保留给外部引用（内容体在 sessionChips/ 下）。
void ListChecks;
