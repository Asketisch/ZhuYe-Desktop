/**
 * StatusPanel —— 会话区右侧**常驻工作台列**（zai 工作台同款形态）。
 *
 * 五段（无内容的段自动隐藏）：
 * - 目标：激活时显示计时（⏱ 分秒）+ GoalBody 快照/设目标表单；
 * - 计划：plan 终稿/草稿行，点击 → 检查器 plan 页签；
 * - 进程：todolist 三态清单 + 完成计数；
 * - 上下文容量：总进度条 + 输入/输出/缓存读写分解条 + 缓存命中率；
 * - 凭据池：模型组内凭据健康（healthy/total）。
 *
 * 布局为 chatpane 的 flex 右列（非 absolute 浮层），可折叠为 44px 窄条。
 * 数据全部来自 store / 既有 IPC（zhuye_credential_pool_status），无新增命令。
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Database,
  FileText, Gauge, ListChecks, Target,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';
import { zhuye_credential_pool_status } from '@/utils/commands/runtimeStatus';
import { GoalBody } from '@/features/shell/sessionChips/GoalBody';
import { useContextRatio } from '@/logic/shell/useContextRatio';
import s from '@/render/shell/session/session.module.css';

type SectionKey = 'goal' | 'plan' | 'todo' | 'context' | 'pool';

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

/** v1.12:六类构成条形的展示行(按声明序,零值类别跳过;条宽以最大类为基准)。 */
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

export function StatusPanel({ goalActive, turnRunning }: {
  goalActive: boolean;
  goalText: string;
  turnRunning: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    goal: true, plan: true, todo: true, context: true, pool: true,
  });
  const todos = useAgentStore((st) => st.todos);
  const contextComposition = useAgentStore((st) => st.contextComposition);
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const plan = useAgentStore((st) => st.plan);
  const planDraft = useAgentStore((st) => st.planDraft);
  const tokens = useAgentStore((st) => st.tokens);
  const context = useContextRatio();
  const compositionRows = compositionRowsOf(contextComposition);
  const setDockOpen = useShellUi((st) => st.setDockOpen);
  const setDockMode = useShellUi((st) => st.setDockMode);
  const setInspectorTab = useShellUi((st) => st.setInspectorTab);

  // 目标计时（goal 激活时每秒跳动；非激活不跑定时器）。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!goalActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goalActive]);
  const goalElapsed = goalActive ? formatElapsed(goalSnapshot?.started_at, now) : '';

  const poolQ = useQuery({
    queryKey: ['workbench-pool'],
    queryFn: zhuye_credential_pool_status,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const pools = poolQ.data ?? [];

  const doneCount = todos.filter((td) => td.status === 'completed').length;
  const planState = plan ? 'ready' : planDraft ? 'draft' : null;
  const planTitle = plan?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? planDraft?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? t('statusPanel.planDraft');

  const hasGoal = goalActive || goalSnapshot != null;
  const hasContent = todos.length > 0 || hasGoal || planState != null || turnRunning
    || context.ratio != null || pools.length > 0;

  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const openPlanInDock = () => {
    setDockMode('inspector');
    setInspectorTab('plan');
    setDockOpen(true);
  };

  /* ===== 折叠窄条（44px，图标直达各段） ===== */
  if (collapsed) {
    return (
      <aside className={s.workbenchCollapsed} data-testid="workbench-collapsed">
        <button
          type="button"
          className={s.statusPanelBtn}
          aria-label={t('statusPanel.expand')}
          title={t('statusPanel.expand')}
          data-testid="workbench-expand"
          onClick={() => setCollapsed(false)}
        >
          <ChevronLeft strokeWidth={1.5} aria-hidden />
        </button>
        {hasGoal && (
          <button type="button" className={s.wbMiniIcon} aria-label={t('statusPanel.goal')} title={t('statusPanel.goal')} onClick={() => setCollapsed(false)}>
            <Target size={15} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        {planState && (
          <button type="button" className={s.wbMiniIcon} aria-label={t('statusPanel.plan')} title={t('statusPanel.plan')} onClick={() => { setCollapsed(false); openPlanInDock(); }}>
            <FileText size={15} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        {todos.length > 0 && (
          <button type="button" className={s.wbMiniIcon} aria-label={t('statusPanel.todo')} title={t('statusPanel.todo')} onClick={() => setCollapsed(false)}>
            <ListChecks size={15} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        <button type="button" className={s.wbMiniIcon} aria-label={t('statusPanel.context')} title={t('statusPanel.context')} onClick={() => setCollapsed(false)}>
          <Gauge size={15} strokeWidth={1.5} aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside className={s.workbench} data-testid="workbench-panel" data-turn-running={turnRunning || undefined}>
      <div className={s.statusPanelCtl}>
        <button
          type="button"
          className={s.statusPanelBtn}
          aria-label={t('statusPanel.collapse')}
          title={t('statusPanel.collapse')}
          data-testid="status-panel-collapse"
          onClick={() => setCollapsed(true)}
        >
          <ChevronRight strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {/* 目标：仅在 goal 模式（激活或有快照）时显示 —— 面板信息按需
          出现，空闲态不常驻「目标」空段（/goal 输入唯一入口在 composer）。 */}
      {hasGoal && (
      <section className={s.statusSection} data-status-section="goal">
        <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('goal')} aria-expanded={openSections.goal}>
          {openSections.goal
            ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
            : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
          <span className={s.statusSectionTitle}>{t('statusPanel.goal')}</span>
          {goalActive && goalElapsed && (
            <span className={s.statusSide} data-testid="status-panel-goal-elapsed">⏱ {goalElapsed}</span>
          )}
        </button>
        {openSections.goal && (
          <div className={s.statusRows} data-testid="status-panel-goal">
            {/* GoalBody 纯只读展示目标快照（含迭代轮次）；输入唯一入口是 composer /goal。 */}
            <GoalBody />
          </div>
        )}
      </section>
      )}

      {/* 计划（右侧 dock 的 plan 页签入口） */}
      {planState && (
        <section className={s.statusSection} data-status-section="plan">
          <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('plan')} aria-expanded={openSections.plan}>
            {openSections.plan
              ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
            <span className={s.statusSectionTitle}>{t('statusPanel.plan')}</span>
          </button>
          {openSections.plan && (
            <div className={s.statusRows}>
              <button type="button" className={s.statusRowBtn} data-testid="status-panel-plan" onClick={openPlanInDock}>
                <FileText size={14} strokeWidth={1.5} className={s.statusRowIcon} aria-hidden />
                <span className={s.statusRowTxt}>{planTitle}</span>
                <span className={s.statusSide} data-state={planState}>{t(`statusPanel.plan_${planState}`)}</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* 进程（todolist 进度） */}
      {todos.length > 0 && (
        <section className={s.statusSection} data-status-section="todo">
          <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('todo')} aria-expanded={openSections.todo}>
            {openSections.todo
              ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
            <span className={s.statusSectionTitle}>{t('statusPanel.todo')}</span>
            <span className={s.statusSide} data-state={doneCount === todos.length ? 'done' : undefined}>
              {doneCount}/{todos.length}
            </span>
          </button>
          {openSections.todo && (
            <div className={s.statusRows}>
              {todos.map((td, tdIndex) => (
                <div key={tdIndex} className={s.statusRow} data-status={td.status} data-testid="status-panel-todo-row">
                  {td.status === 'completed'
                    ? <CheckCircle2 size={14} strokeWidth={1.5} className={`${s.statusRowIcon} ${s.statusOk}`} aria-hidden />
                    : <ListChecks size={14} strokeWidth={1.5} className={s.statusRowIcon} aria-hidden />}
                  <span className={s.statusRowTxt}>{td.active_form ?? td.content}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 上下文容量（总进度 + 输入/输出分解 + 缓存命中率 + v1.12 六类构成条）。
          构成数据来自引擎 context_composition 事件（model_call 组装后计量,
          指纹去重)—— 收到即渲染,未收到(旧引擎/无 turn)不占位。 */}
      {context.ratio != null && (
        <section className={s.statusSection} data-status-section="context">
          <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('context')} aria-expanded={openSections.context}>
            {openSections.context
              ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
            <span className={s.statusSectionTitle}>{t('statusPanel.context')}</span>
            <span className={s.statusSide} data-warn={context.warn || undefined} data-testid="status-panel-context-pct">
              {context.pct}%
            </span>
          </button>
          {openSections.context && (
            <div className={s.statusRows} data-testid="status-panel-context">
              <div className={s.wbMeter} data-warn={context.warn || undefined}>
                <i style={{ width: `${context.pct}%` }} />
              </div>
              <div className={s.wbKvRow}>
                <span>{t('statusPanel.contextUsed')}</span>
                <span className={s.wbKvVal}>{(context.usedTokens ?? 0).toLocaleString()}</span>
              </div>
              <div className={s.wbKvRow}>
                <span>{t('statusPanel.contextWindow')}</span>
                <span className={s.wbKvVal}>{(context.windowSize ?? 0).toLocaleString()}</span>
              </div>
              <div className={s.wbKvRow}>
                <span>{t('statusPanel.cacheHit')}</span>
                <span className={s.wbKvVal} data-testid="status-panel-cache-hit">
                  {tokens && tokens.input > 0
                    ? `${Math.round((tokens.cached / tokens.input) * 100)}%`
                    : '—'}
                </span>
              </div>
              <div className={s.wbKvRow}>
                <span>{t('statusPanel.inputOutput')}</span>
                <span className={s.wbKvVal}>
                  {(tokens?.input ?? 0).toLocaleString()} / {(tokens?.output ?? 0).toLocaleString()}
                </span>
              </div>
              {compositionRows.length > 0 && (
                <div data-testid="status-panel-composition">
                  <div className={s.wbKvRow}>
                    <span>{t('statusPanel.composition')}</span>
                  </div>
                  {compositionRows.map((row) => (
                    <div key={row.id} className={s.wbKvRow}>
                      <span>{t(row.labelKey)}</span>
                      <span className={s.wbMeterMini} data-testid={`status-panel-comp-${row.id}`}>
                        <i style={{ width: `${row.pct}%` }} />
                      </span>
                      <span className={s.wbKvVal}>{row.tokens.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 凭据池（模型组内凭据健康，30s 轮询） */}
      {pools.length > 0 && (
        <section className={s.statusSection} data-status-section="pool">
          <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('pool')} aria-expanded={openSections.pool}>
            {openSections.pool
              ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
            <span className={s.statusSectionTitle}>{t('statusPanel.pool')}</span>
            <Database size={12} strokeWidth={1.5} className={s.statusRowIcon} aria-hidden />
          </button>
          {openSections.pool && (
            <div className={s.statusRows} data-testid="status-panel-pool">
              {pools.map((p) => (
                <div key={p.group} className={s.statusRow}>
                  <span className={s.statusRowTxt}>{p.group}</span>
                  <span className={`${s.statusSide} ${s.wbPoolCount}`} data-ok={p.healthy >= p.total || undefined}>
                    {p.healthy}/{p.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 无内容兜底：提示 + 保持面板可折叠 */}
      {!hasContent && (
        <div className={s.statusRows}>
          <div className={s.statusRow}>
            <span className={s.statusRowTxt} style={{ color: 'var(--text-muted)' }}>
              {t('statusPanel.workbenchIdle')}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
