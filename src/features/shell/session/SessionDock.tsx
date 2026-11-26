/** * SessionDock —— composer 上方的会话内 chips 行。
 *
 * 任务清单 / 目标已迁移到右上角浮动状态面板（StatusPanel，分节 + mini 胶囊）；
 * 本行保留三块会话内速控内容：
 *   子代理 —— 运行中的 child 快照与进度流尾部；
 *   排队 —— 前端跟进消息队列（移除/立即发送，走 store 既有 action）。
 *
 * 每块一个 chip + 弹层（同一时刻只开一个）。内容体在
 * `features/shell/sessionChips/`；数据全部来自既有 store，不新增 IPC。
 */
import { useEffect, useRef, useState } from 'react';
import { List, Loader2, Send, X, Bot } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, selectQueuedForActiveSession } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { SubagentsBody } from '@/features/shell/sessionChips/SubagentsBody';
import s from '@/render/shell/session/session.module.css';

/** 可展开的 chips（同一时刻只开一个）。 */type PopKind = 'subagents' | 'queue';

function useOutsideClose(onClose: () => void) {  const ref = useRef<HTMLSpanElement>(null);
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

export function SessionDock({  turnRunning,
}: {
  goalActive: boolean;
  goalText: string;
  turnRunning: boolean;
}) {
  const { t } = useI18n();
  const subagentsFeed = useAgentStore((st) => st.subagents.feed);
  const subagentsStatus = useAgentStore((st) => st.subagents.lastStatus);
  // v1.x 后台持续运行:只展示当前前台会话的队列。
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  const removeQueued = useAgentStore((st) => st.removeQueued);
  const drainQueue = useAgentStore((st) => st.drainQueue);

  const [openPop, setOpenPop] = useState<PopKind | null>(null);  const subagentsRef = useOutsideClose(() => setOpenPop((v) => (v === 'subagents' ? null : v)));
  const queueRef = useOutsideClose(() => setOpenPop((v) => (v === 'queue' ? null : v)));

  // 子代理：无任何活动时不显示该 chip。
  const hasSubagents = subagentsFeed.length > 0 || (subagentsStatus ?? []).length > 0;
  const runningSubagents = (subagentsStatus ?? []).filter((c) => c.state === 'running');
  const subagentsBadge = runningSubagents.length > 0
    ? `${runningSubagents.length}`
    : `${(subagentsStatus ?? []).length}`;

  return (    <div className={s.dock} data-testid="session-dock">
      {/* 任务清单 / 目标已迁移到会话区折叠胶囊（SessionCapsule），此处不再重复。 */}

      {/* ===== 子代理 ===== */}      {hasSubagents && (
        <span className={s.anch} ref={subagentsRef}>
          <button
            type="button"
            className={s.chip}
            data-testid="session-dock-subagents"
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

      {/* ===== 排队 ===== */}      {queued.length > 0 && (
        <span className={s.anch} ref={queueRef}>
          <button
            type="button"
            className={s.chip}
            data-testid="session-dock-queue"
            aria-expanded={openPop === 'queue'}
            onClick={() => setOpenPop((v) => (v === 'queue' ? null : 'queue'))}
          >
            <List size={13} />
            <span className={s.chipTxt}>{t('dock.queue')} {queued.length}</span>
          </button>
          {openPop === 'queue' && (
            <span className={`${s.pop} ${s.popUp}`} style={{ minWidth: 360, display: 'block', right: 0, left: 'auto' }}>
              <span className={s.popHead} style={{ display: 'flex' }}>
                <List size={12} /> {t('dock.queue')}({queued.length})
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
                        title={t('dock.remove')}
                        aria-label={t('dock.remove')}
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
                  <><Loader2 size={12} className={s.zySpin ?? ''} /> {t('dock.queueRunning')}</>
                ) : (
                  <button
                    type="button"
                    className={s.popRow}
                    style={{ color: 'var(--accent)', width: 'auto' }}
                    onClick={() => { void drainQueue(); setOpenPop(null); }}
                  >
                    <Send size={12} /> {t('dock.sendNow')}
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
