/**
 * StatusPanel —— 会话区右上角的浮动状态面板。
 *
 * 三节：目标 / 计划 / 进程（todolist）。两态：
 * - mini：单行胶囊（优先级链 = 进行中的 todo → 活动目标 → 计划态 → 完成计数），
 *   点击任意段展开为面板；
 * - panel：w-80 圆角卡片，分节可折叠；右上角按钮收回 mini。
 * 宽度充足（≥1280px 容器）时 auto 态默认展开面板，否则胶囊。
 *
 * 数据全部来自 agentStore（goal / plan / todos），不新增 IPC。
 * 「计划」行点击 → 打开右侧 dock 检查器并切到 plan 页签（shellUi）。
 */
import { useState } from 'react';
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronRight, FileText, ListChecks,
  Maximize2, Minimize2, Target,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { useShellUi } from '@/stores/shellUi';
import { useI18n } from '@/utils/i18n';
import { GoalBody, goalStatusLabel } from '@/features/shell/sessionChips/GoalBody';
import s from '@/render/shell/session/session.module.css';

type Variant = 'auto' | 'mini' | 'panel';
type SectionKey = 'goal' | 'plan' | 'todo';

export function StatusPanel({ goalActive, goalText, turnRunning }: {
  goalActive: boolean;
  goalText: string;
  turnRunning: boolean;
}) {
  const { t } = useI18n();
  const [variant, setVariant] = useState<Variant>('auto');
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    goal: true, plan: true, todo: true,
  });
  const todos = useAgentStore((st) => st.todos);
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const plan = useAgentStore((st) => st.plan);
  const planDraft = useAgentStore(useShallow((st) => st.planDraft));
  const setDockOpen = useShellUi((st) => st.setDockOpen);
  const setDockMode = useShellUi((st) => st.setDockMode);
  const setInspectorTab = useShellUi((st) => st.setInspectorTab);

  const doneCount = todos.filter((td) => td.status === 'completed').length;
  const inProgress = todos.find((td) => td.status === 'in_progress');
  const goalTitle = goalActive
    ? (goalText || goalStatusLabel(t, goalSnapshot?.status))
    : t('harness.corner.goal.setIdle');
  const planState = plan ? 'ready' : planDraft ? 'draft' : null;
  const planTitle = plan?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? planDraft?.markdown?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
    ?? t('statusPanel.planDraft');

  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const openPlanInDock = () => {
    setDockMode('inspector');
    setInspectorTab('plan');
    setDockOpen(true);
  };

  /* ===== mini 胶囊（单行优先级链） ===== */
  const mini = (
    <button
      type="button"
      className={s.statusPill}
      data-testid="status-panel-pill"
      aria-label={t('statusPanel.expand')}
      onClick={() => setVariant('panel')}
    >
      {inProgress && (
        <span className={s.statusMetric}>
          <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
          <span className={s.statusMetricTxt}>{inProgress.active_form ?? inProgress.content}</span>
        </span>
      )}
      <span className={s.statusMetric} data-goal-active={goalActive || undefined}>
        <Target size={14} strokeWidth={1.5} aria-hidden />
        <span className={s.statusMetricTxt}>{goalTitle}</span>
      </span>
      {planState && (
        <span className={s.statusMetric}>
          <FileText size={14} strokeWidth={1.5} aria-hidden />
          <span className={s.statusMetricTxt}>{t('statusPanel.plan')}</span>
        </span>
      )}
      {todos.length > 0 && (
        <span className={`${s.statusMetric} ${s.statusDone}`}>
          <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden />
          <span className={s.statusMetricTxt}>{doneCount}/{todos.length}</span>
        </span>
      )}
      <Maximize2 size={13} strokeWidth={1.5} className={s.statusExpandIcon} aria-hidden />
    </button>
  );

  /* ===== 展开面板 ===== */
  const panel = (
    <aside className={s.statusPanel} data-testid="status-panel" data-turn-running={turnRunning || undefined}>
      <div className={s.statusPanelCtl}>
        <button
          type="button"
          className={s.statusPanelBtn}
          aria-label={t('statusPanel.collapse')}
          title={t('statusPanel.collapse')}
          data-testid="status-panel-collapse"
          onClick={() => setVariant('mini')}
        >
          <Minimize2 size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {/* 目标（常驻：空闲时 GoalBody 提供设目标表单） */}
      {(
        <section className={s.statusSection} data-status-section="goal">
          <button type="button" className={s.statusSectionHead} onClick={() => toggleSection('goal')} aria-expanded={openSections.goal}>
            {openSections.goal
              ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
              : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
            <span className={s.statusSectionTitle}>{t('statusPanel.goal')}</span>
          </button>
          {openSections.goal && (
            <div className={s.statusRows} data-testid="status-panel-goal">
              {/* GoalBody 自带目标快照展示与设目标表单（含迭代轮次控制）。 */}
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

      {/* 进程（todolist） */}
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
    </aside>
  );

  // auto：容器 ≥1280px 展开面板，否则胶囊（容器查询见 session.module.css）。
  return (
    <div className={s.statusWrap} data-variant={variant}>
      {variant === 'mini' ? mini : variant === 'panel' ? panel : (
        <>
          <span className={s.statusAutoMini}>{mini}</span>
          <span className={s.statusAutoPanel}>{panel}</span>
        </>
      )}
    </div>
  );
}
