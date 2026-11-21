/**
 * ComposerControls —— 输入卡片下方的控制行（思考深度 / 审批策略 / 权限模式）。
 *
 * 渲染在输入卡片**下方**的独立一行（不在卡片内部），对标成熟 agent
 * 桌面端：选择器贴近输入框，不必跳设置页或拼斜杠命令。
 *
 * - 模型选择器已独立成 `ModelPicker`（渲染在卡片内底栏右侧，见
 *   `features/composer/ModelPicker.tsx`）—— 本行不再重复。
 * - 思考深度：`zhuye_get_effort` 回读 + `zhuye_set_effort` 设置
 *   （乐观更新 —— 协议无 effort 变更事件，读回仅在下次挂载时刷新）。
 * - 工作模式由 agentStore 回读；审批策略按会话单独保存并在发送时传入。
 *
 * 数据获取用 useEffect + useState（同 ChatView 的 git diff 模式），
 * 不引入 QueryClient 依赖，保证 Composer 在任意测试挂载环境可用。
 */
import { useEffect, useMemo, useState } from 'react';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { zhuye_get_effort, zhuye_set_effort } from '@/utils/commands/permissions';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { readApprovalPolicy, writeApprovalPolicy, type UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import { readPromptSelection, writePromptSelection } from '@/stores/agent/promptSelection';
import type { PromptSelection } from '@/utils/commands/prompts';
import { ALL_EFFORTS, useEffortCapability } from './useEffortCapability';
import s from '@/render/composer/ComposerControls.module.css';

// 上游 v1.x 起 max / ultra 为新增档位(按模型能力表发送前钳制)。
const EFFORTS = ALL_EFFORTS;
type Effort = (typeof EFFORTS)[number];

/** zustand selector 的稳定空引用 —— `?? []` 每次渲染新建数组会让
 *  useSyncExternalStore 快照永不相等而无限重渲染(React 19 抛
 *  Maximum update depth exceeded)。 */
const NO_PROMPT_LAYERS: readonly string[] = [];

/** 会话工作模式三段(Plan/Ask/默认);工具审批策略由独立选择器控制。
 *  与核心 PermissionMode 三段对齐(wire: plan/prompt/auto);
 *  默认档自动批准文件编辑,其余按规则放行、高危仍确认。 */
const PERMISSION_SEGMENTS = [
  { value: 'plan', labelKey: 'composer.controls.perm.plan', hintKey: 'composer.controls.planHint' },
  { value: 'prompt', labelKey: 'composer.controls.perm.ask', hintKey: 'composer.controls.askHint' },
  { value: 'auto', labelKey: 'composer.controls.perm.auto', hintKey: 'composer.controls.defaultHint' },
] as const;

export function ComposerControls() {
  const { t } = useI18n();
  const permissionMode = useAgentStore((st) => st.permissionMode);
  // 思考强度能力(按当前模型):只提供模型支持的档位,并把「用户选择」与
  // 「实际生效」分开显示 —— 偏好保留,换模型后自动重算。
  const capability = useEffortCapability();
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  // 会话轮次:提示词预设入口只在「最初创建会话」窗口(turns 为空)显示,
  // 会话开始后锁定 —— 系统提示词恒定是供应商 prompt cache 命中的前提。
  const turnsEmpty = useAgentStore((st) => st.turns.length === 0);
  const promptAvailable = useAgentStore((st) => st.prompt?.available ?? NO_PROMPT_LAYERS);
  const promptFallback = useAgentStore((st) => st.prompt?.fallbackReason ?? null);
  const promptList = useAgentStore((st) => st.promptList);
  const [approvalPolicy, setApprovalPolicy] = useState<UserApprovalPolicy>(() => readApprovalPolicy(sessionId));
  useEffect(() => { setApprovalPolicy(readApprovalPolicy(sessionId)); }, [sessionId]);
  // 提示词预设:per-session localStorage(null 会话走 'new' 键,创建后转正);
  // bind 恢复由 ChatBinding 的 syncSessionPromptSelection 负责,这里只管选择与回显。
  const [promptSelection, setPromptSelection] = useState<PromptSelection>(
    () => readPromptSelection(sessionId) ?? { mode: 'default' },
  );
  useEffect(() => { setPromptSelection(readPromptSelection(sessionId) ?? { mode: 'default' }); }, [sessionId]);
  // 可用层清单(prompt_list 事件异步回流) —— 空会话挂载时拉一次。
  // catch 防御:拉取失败不阻断 composer(选项退化为默认/智能两项)。
  useEffect(() => {
    if (turnsEmpty && useAgentStore.getState().prompt === null) {
      promptList().catch(() => { /* 清单拉不到就用默认两项 */ });
    }
  }, [turnsEmpty, promptList]);
  const goalActive = useAgentStore((st) => st.goalActive);
  // v1.7 后端快照:徽标 tooltip 从「只有固定文案」升级为实际进度
  // (轮次 / token / 状态),数据来自 zhuye_goal_snapshot 读口。
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const setPermissionMode = useAgentStore((st) => st.setPermissionMode);

  const [effort, setEffort] = useState<Effort>('low');

  // 回读当前档位;配置重载(config_reloaded,含设置页保存 / 手改 TOML)
  // 时重读 —— 默认思考强度落地后引擎重绑新线程带新 initial,这里跟上,
  // 不等下次挂载。
  const rereadEffort = () => {
    zhuye_get_effort()
      .then((level) => setEffort(normalizeEffort(level)))
      .catch(() => {/* 回读失败保持当前显示 */});
  };
  useEffect(() => {
    let cancelled = false;
    zhuye_get_effort()
      .then((level) => {
        if (!cancelled) setEffort(normalizeEffort(level));
      })
      .catch(() => {/* 回读失败保持默认 */});
    const unsubscribe = subscribeAgentEvent((event) => {
      if (event.msg.type === 'config_reloaded') rereadEffort();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 可选档位 = 模型支持的档位 ∪ 用户当前选择(偏好保留,即使当前模型不支持)。
  const effortOptions = useMemo(() => {
    const options = new Set<Effort>(capability.options);
    options.add(effort);
    return EFFORTS.filter((level) => options.has(level));
  }, [capability.options, effort]);

  const onSetEffort = (level: Effort) => {
    setEffort(level);
    void zhuye_set_effort(level).catch(() => {
      // 乐观更新失败回滚读不到真值 —— 保持所选，下次挂载会对齐。
    });
  };

  return (
    <div className={s.controlsBar}>
      <div className={s.left}>
        <label className={s.control}>
          <span className={s.controlLabel}>{t('composer.controls.effort')}</span>
          <select
            className={s.controlSelect}
            value={effort}
            onChange={(event) => onSetEffort(normalizeEffort(event.target.value))}
            disabled={effortOptions.length === 0}
            title={capability.known ? undefined : t('composer.controls.effort.unknownHint')}
            aria-label={t('composer.controls.effortAria')}
            data-testid="composer-effort-select"
          >
            {effortOptions.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
          {capability.adjusted && (
            <span className={s.effectiveNote} data-testid="composer-effort-effective">
              {capability.effective
                ? t('composer.controls.effort.effective', { level: capability.effective })
                : t('composer.controls.effort.disabled')}
            </span>
          )}
        </label>
        {turnsEmpty && (
          <label className={s.control}>
            <span className={s.controlLabel}>{t('composer.controls.prompt')}</span>
            <select
              className={s.controlSelect}
              value={promptSelection.mode === 'manual' ? promptSelection.profile : promptSelection.mode}
              onChange={(event) => {
                const raw = event.target.value;
                const value: PromptSelection = raw === 'default' || raw === 'auto'
                  ? { mode: raw }
                  : { mode: 'manual', profile: raw };
                setPromptSelection(value);
                writePromptSelection(sessionId, value);
              }}
              title={t('composer.controls.prompt.hint')}
              aria-label={t('composer.controls.promptAria')}
              data-testid="composer-prompt-select"
            >
              <option value="default">{t('composer.controls.prompt.follow')}</option>
              <option value="auto" title={promptFallback ?? t('composer.controls.prompt.autoHint')}>
                {t('composer.controls.prompt.auto')}
              </option>
              {promptAvailable.filter((layer) => layer !== 'default').map((layer) => (
                <option key={layer} value={layer}>{layer}</option>
              ))}
            </select>
            {promptSelection.mode === 'auto' && promptFallback && (
              <span className={s.effectiveNote} data-testid="composer-prompt-fallback">
                {promptFallback}
              </span>
            )}
          </label>
        )}
      </div>

      <div className={s.right}>
        <label className={s.control}>
          <span className={s.controlLabel}>{t('composer.controls.approval')}</span>
          <select className={s.controlSelect} value={approvalPolicy} data-testid="composer-approval-policy" title={t('composer.controls.approval.hint')}
            aria-label={t('composer.controls.approval')}
            onChange={(event) => {
              const value = event.target.value as UserApprovalPolicy;
              setApprovalPolicy(value);
              writeApprovalPolicy(sessionId, value);
            }}>
            <option value="auto">{t('composer.controls.approval.follow')}</option>
            <option value="prompt">{t('composer.controls.approval.prompt')}</option>
            <option value="auto_approve">{t('composer.controls.approval.auto')}</option>
            <option value="full_access">{t('composer.controls.approval.full')}</option>
          </select>
        </label>
        {goalActive && (
          <span
            className={s.goalBadge}
            title={
              goalSnapshot
                ? t('composer.goalBadgeDetail', {
                    turns: goalSnapshot.turn_count,
                    tokens: goalSnapshot.tokens_used,
                    status: goalSnapshot.status,
                  })
                : t('composer.goalBadge')
            }
            data-testid="composer-goal-badge"
          >
            🎯 {t('composer.goalBadgeLabel')}
          </span>
        )}
        <div className={s.permSwitch} role="radiogroup" aria-label={t('composer.controls.permissionAria')} data-testid="composer-permission-switch">
          {/* v1.x:store 的 permissionMode 经 normalizePermissionMode 归一
              (reducer 事件回读 + bind 返回值同步两个写入口),恒为三态,
              无需对弃用档做裸回显。 */}
          {PERMISSION_SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              role="radio"
              aria-checked={permissionMode === segment.value}
              className={s.permBtn}
              data-active={permissionMode === segment.value || undefined}
              onClick={() => void setPermissionMode(segment.value)}
              title={t(segment.hintKey)}
              data-testid={`composer-perm-${segment.value}`}
            >
              {t(segment.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeEffort(value: string): Effort {
  return (EFFORTS as readonly string[]).includes(value) ? (value as Effort) : 'low';
}
