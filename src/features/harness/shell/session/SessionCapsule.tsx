/**
 * SessionCapsule —— 会话区的折叠胶囊（替代原 300px 常驻右列）。
 *
 * v1.13:原先目标 / 计划 / 进程 / 上下文 摊在会话区**右侧的常驻工作台
 * 列**（`StatusPanel` + `chatpane` 的 flex 右列），把对话区挤窄、且与
 * 右 dock 的信息重复。现收进会话流里的**一行折叠胶囊**：
 *   收起 = 单行摘要（进程 / 目标 / 上下文%，有哪段显哪段）
 *   展开 = 分节面板（目标 / 进程 / 上下文）
 *
 * 计划**不进胶囊**——计划正文仍由右 dock 的「计划」标签页渲染
 * （`PlanDock` + `usePlanSurfacing` 的浮出策略完全不动）；胶囊里只给
 * 一个跳右 dock 的入口行。
 *
 * 形态对齐 minimax-code TUI 的 footer 胶囊（`TuiTaskPanel`）：
 * 紧凑单行 + 展开分节，而不是常驻面板。
 */
import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronRight, FileText, Gauge, ListChecks, Target,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';
import { GoalBody } from '@/features/harness/shell/sessionChips/GoalBody';
import { useContextRatio } from '@/logic/shell/useContextRatio';
import { useTurnCacheHitRate } from '@/logic/usage/cacheHitRate';
import s from '@/render/harness/shell/session/sessionCapsule.module.css';

/** 展开面板里的分节。 */
type SectionKey = 'goal' | 'todo' | 'context';

/** 把 RFC3339 起始时间格式化为「X分Y秒 / X小时Y分」。 */
function formatElapsed(startedAt: string | undefined, now: number): string {
  if (!startedAt) return '';
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return '';
  const secs = Math.max(0, Math.floor((now - started) / 1000));
  const m = Math.floor(secs / 60);
  const sec = secs % 60;
  if (m < 60) return `${m}分${String(sec).padStart(2, '0')}秒`;
  return `${Math.floor(m / 60)}小时${String(m % 60).padStart(2, '0')}分`;
}

/** v1.12:六类构成条形的展示行（按声明序，零值类别跳过）。 */
const COMPOSITION_LABELS: Record<string, string> = {
  system_prompt: 'statusPanel.comp.systemPrompt',
  memory: 'statusPanel.comp.memory',
  skills: 'statusPanel.comp.skills',
  tool_schemas: 'statusPanel.comp.toolSchemas',
  mcp_tools: 'statusPanel.comp.mcpTools',
  messages: 'statusPanel.comp.messages',
};

function compositionRowsOf(categories: { id: string; tokens: number }[] | null) {
  if (!categories || categories.length === 0) return [];
  const max = Math.max(...categories.map((c) => c.tokens), 1);
  return categories
    .filter((c) => c.tokens > 0 && COMPOSITION_LABELS[c.id])
    .map((c) => ({
      id: c.id,
      labelKey: COMPOSITION_LABELS[c.id],
      tokens: c.tokens,
      pct: Math.max(2, Math.round((c.tokens / max) * 100)),
    }));
}

export function SessionCapsule({ goalActive, turnRunning }: {
  goalActive: boolean;
  turnRunning: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    goal: true, todo: true, context: true,
  });
  const todos = useAgentStore((st) => st.todos);
  const contextComposition = useAgentStore((st) => st.contextComposition);
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const plan = useAgentStore((st) => st.plan);
  const planDraft = useAgentStore((st) => st.planDraft);
  const tokens = useAgentStore((st) => st.tokens);
  const context = useContextRatio();
  // 缓存命中率走**回合级**口径（本回合逐次调用的累计），与右侧用量面板的
  // 会话级口径分开 —— 标签各标各的，不混用「平均」这种跨口径词。
  const cacheHitRate = useTurnCacheHitRate();
  const compositionRows = compositionRowsOf(contextComposition);
  const openDockTab = useShellUi((st) => st.openDockTab);

  // 目标计时（goal 激活时每秒跳动；非激活不跑定时器）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!goalActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goalActive]);
  const goalElapsed = goalActive ? formatElapsed(goalSnapshot?.started_at, now) : '';

  const doneCount = todos.filter((td) => td.status === 'completed').length;
  const planState = plan ? 'ready' : planDraft ? 'draft' : null;
  const planTitle = plan?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? planDraft?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? t('statusPanel.planDraft');

  const hasGoal = goalActive || goalSnapshot != null;
  const hasContent = todos.length > 0 || hasGoal || planState != null || turnRunning
    || context.ratio != null;

  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // 完全没有内容时不占位（空闲态不该有一条空胶囊）。
  if (!hasContent) return null;

  return (
    <div className={s.wrap} data-testid="session-capsule" data-open={open || undefined}>
      <button
        type="button"
        className={s.summary}
        aria-expanded={open}
        data-testid="session-capsule-summary"
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown size={13} strokeWidth={1.5} aria-hidden />
          : <ChevronRight size={13} strokeWidth={1.5} aria-hidden />}
        <span className={s.summaryItems}>
          {todos.length > 0 && (
            <span className={s.item} data-kind="todo">
              <ListChecks size={12} strokeWidth={1.5} aria-hidden />
              {t('statusPanel.todo')} {doneCount}/{todos.length}
            </span>
          )}
          {hasGoal && (
            <span className={s.item} data-kind="goal">
              <Target size={12} strokeWidth={1.5} aria-hidden />
              {t('statusPanel.goal')}{goalElapsed ? ` ${goalElapsed}` : ''}
            </span>
          )}
          {context.ratio != null && (
            <span className={s.item} data-kind="context">
              <Gauge size={12} strokeWidth={1.5} aria-hidden />
              {t('statusPanel.context')} {context.pct}%
            </span>
          )}
          {planState && (
            <span className={s.item} data-kind="plan" data-state={planState}>
              <FileText size={12} strokeWidth={1.5} aria-hidden />
              {t('statusPanel.plan')} {t(`statusPanel.plan_${planState}`)}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className={s.panel} data-testid="session-capsule-panel">
          {/* 目标：仅在 goal 模式（激活或有快照）时显示 —— 面板信息按需
              出现，空闲态不常驻「目标」空段（/goal 输入唯一入口在 composer）。 */}
          {hasGoal && (
            <section className={s.section} data-status-section="goal">
              <button type="button" className={s.sectionHead} onClick={() => toggleSection('goal')} aria-expanded={openSections.goal}>
                {openSections.goal
                  ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                  : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                <span className={s.sectionTitle}>{t('statusPanel.goal')}</span>
                {goalActive && goalElapsed && (
                  <span className={s.side} data-testid="capsule-goal-elapsed">⏱ {goalElapsed}</span>
                )}
              </button>
              {openSections.goal && (
                <div className={s.rows} data-testid="capsule-goal">
                  <GoalBody />
                </div>
              )}
            </section>
          )}

          {/* 计划：正文在右 dock「计划」标签页，这里只给跳转入口。 */}
          {planState && (
            <section className={s.section} data-status-section="plan">
              <div className={s.sectionHead} data-testid="capsule-plan-head">
                <FileText size={14} strokeWidth={1.5} aria-hidden />
                <span className={s.sectionTitle}>{t('statusPanel.plan')}</span>
                <span className={s.side} data-state={planState}>{t(`statusPanel.plan_${planState}`)}</span>
              </div>
              <div className={s.rows}>
                <button
                  type="button"
                  className={s.rowBtn}
                  data-testid="capsule-plan"
                  onClick={() => openDockTab('plan')}
                >
                  <FileText size={14} strokeWidth={1.5} className={s.rowIcon} aria-hidden />
                  <span className={s.rowTxt}>{planTitle}</span>
                </button>
              </div>
            </section>
          )}

          {/* 进程（todolist 进度） */}
          {todos.length > 0 && (
            <section className={s.section} data-status-section="todo">
              <button type="button" className={s.sectionHead} onClick={() => toggleSection('todo')} aria-expanded={openSections.todo}>
                {openSections.todo
                  ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                  : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                <span className={s.sectionTitle}>{t('statusPanel.todo')}</span>
                <span className={s.side} data-state={doneCount === todos.length ? 'done' : undefined}>
                  {doneCount}/{todos.length}
                </span>
              </button>
              {openSections.todo && (
                <div className={s.rows}>
                  {todos.map((td, tdIndex) => (
                    <div key={tdIndex} className={s.row} data-status={td.status} data-testid="capsule-todo-row">
                      {td.status === 'completed'
                        ? <CheckCircle2 size={14} strokeWidth={1.5} className={s.rowOk} aria-hidden />
                        : <ListChecks size={14} strokeWidth={1.5} className={s.rowIcon} aria-hidden />}
                      <span className={s.rowTxt}>{td.active_form ?? td.content}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 上下文容量（总进度 + 输入/输出分解 + 缓存命中率 + 六类构成条）。
              构成数据来自引擎 context_composition 事件（model_call 组装后计量,
              指纹去重)—— 收到即渲染,未收到(旧引擎/无 turn)不占位。 */}
          {context.ratio != null && (
            <section className={s.section} data-status-section="context">
              <button type="button" className={s.sectionHead} onClick={() => toggleSection('context')} aria-expanded={openSections.context}>
                {openSections.context
                  ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                  : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                <span className={s.sectionTitle}>{t('statusPanel.context')}</span>
                <span className={s.side} data-warn={context.warn || undefined} data-testid="capsule-context-pct">
                  {context.pct}%
                </span>
              </button>
              {openSections.context && (
                <div className={s.rows} data-testid="capsule-context">
                  <div className={s.meter} data-warn={context.warn || undefined}>
                    <i style={{ width: `${context.pct}%` }} />
                  </div>
                  <div className={s.kvRow}>
                    <span>{t('statusPanel.contextUsed')}</span>
                    <span className={s.kvVal}>{(context.usedTokens ?? 0).toLocaleString()}</span>
                  </div>
                  <div className={s.kvRow}>
                    <span>{t('statusPanel.contextWindow')}</span>
                    <span className={s.kvVal}>{(context.windowSize ?? 0).toLocaleString()}</span>
                  </div>
                  <div className={s.kvRow}>
                    <span>{t('statusPanel.cacheHit')}</span>
                    <span className={s.kvVal} data-testid="capsule-cache-hit">
                      {cacheHitRate === null ? '—' : `${Math.round(cacheHitRate)}%`}
                    </span>
                  </div>
                  <div className={s.kvRow}>
                    <span>{t('statusPanel.inputOutput')}</span>
                    <span className={s.kvVal}>
                      {(tokens?.input ?? 0).toLocaleString()} / {(tokens?.output ?? 0).toLocaleString()}
                    </span>
                  </div>
                  {compositionRows.length > 0 && (
                    <div data-testid="capsule-composition">
                      <div className={s.kvRow}>
                        <span>{t('statusPanel.composition')}</span>
                      </div>
                      {compositionRows.map((row) => (
                        <div key={row.id} className={s.kvRow}>
                          <span>{t(row.labelKey)}</span>
                          <span className={s.meterMini} data-testid={`capsule-comp-${row.id}`}>
                            <i style={{ width: `${row.pct}%` }} />
                          </span>
                          <span className={s.kvVal}>{row.tokens.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
