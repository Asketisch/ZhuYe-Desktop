/**
 * ZDock —— composer 上方的状态 chips 行(redesign/zcode-shell)。
 *
 * 三个 chip 各带 popover(DeepSeek dock 堆栈口径):
 *   计划 —— agent TodoWrite 的清单(pending/进行中/完成三态 + 进度条);
 *   目标 —— goal 模式快照(goalSnapshot.objective);
 *   排队 —— 前端跟进消息队列(移除/立即发送,走 store 既有 action)。
 * 数据全部来自既有 store,不新增 IPC。
 */
import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Target, List, X, Pencil, Pause, Play, Send, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import s from './zcode.module.css';

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
  void t;
  const queued = useAgentStore((st) => st.queuedMessages);
  const removeQueued = useAgentStore((st) => st.removeQueued);
  const drainQueue = useAgentStore((st) => st.drainQueue);

  const [openPop, setOpenPop] = useState<'todo' | 'queue' | null>(null);
  const todoRef = useOutsideClose(() => setOpenPop((v) => (v === 'todo' ? null : v)));
  const queueRef = useOutsideClose(() => setOpenPop((v) => (v === 'queue' ? null : v)));

  const doneCount = todos.filter((td) => td.status === 'completed').length;
  const donePct = todos.length === 0 ? 0 : Math.round((doneCount / todos.length) * 100);
  const inProgress = todos.find((td) => td.status === 'in_progress');

  if (todos.length === 0 && !goalActive && queued.length === 0) return null;

  return (
    <div className={s.dock} data-testid="zcode-dock">
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
              {t('zcode.dock.todo')} {doneCount}/{todos.length}
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
            <span className={`${s.pop} ${s.popUp} ${s.zyTodoPop ?? ''}`} style={{ minWidth: 300, display: 'block' }}>
              <span className={s.popHead} style={{ display: 'flex' }}>
                <CheckSquare size={12} /> {t('zcode.dock.todo')} · {doneCount}/{todos.length}
              </span>
              <span style={{ display: 'block', padding: 'var(--space-1) 0' }}>
                {todos.map((td, i) => (
                  <span key={i} className={s.trow} data-status={td.status} style={{ display: 'flex' }}>
                    <span className={s.zyTbox ?? ''}>{td.status === 'completed' ? '✓' : ''}</span>
                    <span className={s.zyTname ?? ''}>{td.active_form ?? td.content}</span>
                  </span>
                ))}
              </span>
            </span>
          )}
        </span>
      )}

      {goalActive && (
        <span className={`${s.goalChip} ${s.chip}`} data-testid="zcode-dock-goal" style={{ cursor: 'default' }}>
          <Target size={13} />
          <span className={s.chipTxt} style={{ color: 'var(--accent)', fontWeight: 500 }}>{t('zcode.dock.goal')}</span>
          <span className={s.chipTxt} style={{ maxWidth: 260 }}>{goalText}</span>
        </span>
      )}

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

// Pencil/Pause/Play 保留导入给 goal 编辑入口(未来接线);此处避免未用告警。
void Pencil; void Pause; void Play;
