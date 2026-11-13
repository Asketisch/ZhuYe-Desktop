/**
 * TrajView —— 轨迹主视图(redesign/zcode-shell,ui-trajectory 口径)。
 *
 * 全宽账本 + 三泳道 Timing 总览 + 右侧记录检查器(400px)。数据源 =
 * store.turns + compactions(traj.ts 推导),零新增 IPC。
 * 折叠:时长(藏泳道)/轮次(只留边界行)/调用(藏工具行)/子调用(藏缩进行)。
 * 搜索:本地过滤账本行(含已折叠行)。
 */
import { useMemo, useState } from 'react';
import { Clock, CornerDownRight, Wrench, GitBranch, Search, ChevronRight, X } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { deriveLanes, deriveTrajEntries } from './traj';
import s from './zcode.module.css';

export function TrajView() {
  const { t } = useI18n();
  const turns = useAgentStore((st) => st.turns);
  const compactions = useAgentStore((st) => st.compactions);

  const entries = useMemo(() => deriveTrajEntries(turns, compactions), [turns, compactions]);
  const lanes = useMemo(() => deriveLanes(entries), [entries]);

  const [foldTime, setFoldTime] = useState(false);
  const [foldTurns, setFoldTurns] = useState(false);
  const [foldCalls, setFoldCalls] = useState(false);
  const [foldSubs, setFoldSubs] = useState(false);
  const [query, setQuery] = useState('');
  const [selIdx, setSelIdx] = useState<number | null>(null);

  const q = query.trim().toLowerCase();
  const visible = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !q || e.text.toLowerCase().includes(q) || (e.args ?? '').toLowerCase().includes(q) || (e.toolName ?? '').toLowerCase().includes(q));

  const sel = selIdx != null ? entries[selIdx] : null;
  const stageCls = `${s.trajstage}`.trim();

  const roleLabel = (role: string) =>
    role === 'user' ? t('zcode.traj.roleUser')
    : role === 'assistant' ? t('zcode.traj.roleAssistant')
    : role === 'reasoning' ? t('zcode.traj.roleReason')
    : role === 'error' ? t('zcode.traj.roleError')
    : t('zcode.traj.roleTool');

  return (
    <div
      className={stageCls}
      data-fold-time={foldTime}
      data-testid="zcode-traj"
      role="tabpanel"
      aria-label={t('zcode.view.traj')}
    >
      {/* 工具栏:折叠 chips + 搜索 */}
      <div className={s.tjBar}>
        <div className={s.tjFolds}>
          <button type="button" className={s.tjFold} data-off={!foldTime} data-testid="zcode-traj-fold-time" onClick={() => setFoldTime((v) => !v)}>
            <Clock size={13} /> {t('zcode.traj.foldTime')}
          </button>
          <button type="button" className={s.tjFold} data-testid="zcode-traj-fold-turns" onClick={() => setFoldTurns((v) => !v)}>
            <CornerDownRight size={13} /> {t('zcode.traj.foldTurns')}
          </button>
          <button type="button" className={s.tjFold} data-testid="zcode-traj-fold-calls" onClick={() => setFoldCalls((v) => !v)}>
            <Wrench size={13} /> {t('zcode.traj.foldCalls')}
          </button>
          <button type="button" className={s.tjFold} data-testid="zcode-traj-fold-subs" onClick={() => setFoldSubs((v) => !v)}>
            <GitBranch size={13} /> {t('zcode.traj.foldSubs')}
          </button>
        </div>
        <span className={s.tjSearch}>
          <Search size={13} />
          <input
            type="text"
            placeholder={t('zcode.traj.search')}
            aria-label={t('zcode.traj.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
      </div>

      {/* 三泳道 Timing 总览(时长折叠时隐藏) */}
      {!foldTime && (
        <div className={s.tl3} data-testid="zcode-traj-timeline" aria-hidden="true">
          <span className={s.tlLabel}>{t('zcode.traj.laneInput')}</span>
          <span className={s.tlLane}>
            {lanes.filter((x) => x.lane === 'input').map((x, i) => (
              <span key={`i${i}`} className={`${s.tlSeg} ${s.tlInp}`} style={{ left: `${x.left}%`, width: `${x.width}%` }} />
            ))}
          </span>
          <span className={s.tlLabel}>{t('zcode.traj.laneModel')}</span>
          <span className={`${s.tlLane} ${s.tlLaneMid}`}>
            {lanes.filter((x) => x.lane === 'model').map((x, i) => (
              <span
                key={`m${i}`}
                className={`${s.tlSeg} ${s.tlModel}`}
                data-sel={selIdx === x.entryIndex}
                style={{ left: `${x.left}%`, width: `${x.width}%` }}
              />
            ))}
          </span>
          <span className={s.tlLabel}>{t('zcode.traj.laneTool')}</span>
          <span className={s.tlLane}>
            {lanes.filter((x) => x.lane === 'tool').map((x, i) => (
              <span
                key={`t${i}`}
                className={`${s.tlSeg} ${s.tlTool} ${x.isError ? s.tlToolErr : ''}`}
                data-sel={selIdx === x.entryIndex}
                style={{ left: `${x.left}%`, width: `${x.width}%` }}
              />
            ))}
          </span>
        </div>
      )}

      {/* 账本 + 检查器侧栏 */}
      <div className={s.tjBody}>
        <div className={s.tjLed}>
          <div
            className={[
              s.led,
              foldTurns ? s.ledFoldTurns : '',
              foldCalls ? s.ledFoldCalls : '',
              foldSubs ? s.ledFoldSubs : '',
            ].filter(Boolean).join(' ')}
            data-testid="zcode-traj-ledger"
          >
            {visible.length === 0 && <div className={s.ledEmpty}>{turns.length === 0 ? t('zcode.traj.empty') : t('zcode.traj.search')}: {query}</div>}
            {visible.map(({ e, i }) => (
              <button
                key={e.key}
                type="button"
                className={`${s.ledRow} ${e.sub ? s.ledSub : ''}`}
                data-sel={selIdx === i}
                data-boundary={e.boundary}
                data-rec={e.role === 'tool_call' ? 'tool_call' : undefined}
                data-sub={e.sub || undefined}
                data-testid={`zcode-traj-row-${i}`}
                onClick={() => setSelIdx(selIdx === i ? null : i)}
              >
                <span className={s.ledRole} data-role={e.role}>{roleLabel(e.role)}</span>
                <span className={`${s.ledLine} ${e.role !== 'tool_call' ? s.ledPlain : ''}`.trim()}>
                  {e.role === 'tool_call' && !e.sub && e.toolName && (
                    <>
                      <span className={s.ledTname}>{e.toolName}</span>
                      {e.args && <span className={s.ledArgs}>{e.args}</span>}
                      <span className={s.ledArr}>→</span>
                    </>
                  )}
                  <span className={s.ledOut}>
                    {e.role === 'tool_call' && e.sub ? (e.isError ? '✕ ' : '') : ''}
                    {e.text}
                    {e.streaming ? ' ▍' : ''}
                  </span>
                </span>
                {(e.role === 'tool_call' || e.role === 'assistant') && (
                  <ChevronRight size={12} style={{ flexShrink: 0, alignSelf: 'center', opacity: 0.5 }} />
                )}
              </button>
            ))}
            <div className={s.ledFoot}>
              <span>{turns.length} turns</span>
              {compactions.count > 0 && (
                <span>compaction ×{compactions.count} · −{compactions.tokensSaved} tok</span>
              )}
            </div>
          </div>

          {/* 检查器侧栏(选中记录) */}
          {sel && (
            <aside className={s.tjInsp} data-testid="zcode-traj-inspector">
              <div className={s.tiHead}>
                <span className={s.tiRole} data-role={sel.role}>{roleLabel(sel.role)}</span>
                <span className={s.tiMeta}>第 {sel.turn} 轮 · 第 {sel.step} 步</span>
                <button type="button" className={s.tiClose} aria-label="close" onClick={() => setSelIdx(null)}>
                  <X size={13} />
                </button>
              </div>
              <div className={s.tiTabs}>
                <button type="button" className={s.tiTab} data-active="true">{t('zcode.traj.overview')}</button>
              </div>
              <div className={s.tiBody} data-active="true">
                <div className={s.tiKv}><span className="zyK">{t('zcode.traj.level')}</span><span className="zyV">{t('zcode.traj.level')} ›</span></div>
                <div className={s.tiKv}>
                  <span className="zyK">{t('zcode.traj.status')}</span>
                  <span className="zyV">{sel.streaming ? t('zcode.traj.statusStreaming') : t('zcode.traj.statusDone')}</span>
                </div>
                {sel.toolName && sel.toolName !== 'output' && (
                  <div className={s.tiSec}>
                    <div className={s.tiSecH}>{t('zcode.traj.params')} <ChevronRight size={13} /></div>
                    <div className={s.tiJson}>{sel.args || t('zcode.traj.emptyField')}</div>
                  </div>
                )}
                <div className={s.tiSec}>
                  <div className={s.tiSecH}>{t('zcode.traj.result')} <ChevronRight size={13} /></div>
                  <div className={s.tiOut}>{sel.text || t('zcode.traj.emptyField')}</div>
                </div>
                <div className={s.tiSec}>
                  <div className={s.tiSecH}>{t('zcode.traj.status')} <ChevronRight size={13} /></div>
                  <div className={s.tiKv}><span className="zyK">{t('zcode.traj.status')}</span><span className="zyV">{sel.streaming ? t('zcode.traj.statusStreaming') : t('zcode.traj.statusDone')}</span></div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
