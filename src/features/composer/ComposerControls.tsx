/**
 * ComposerControls —— Composer 控制条（模型 / 思考深度 / 权限模式）。
 *
 * 渲染在输入卡片**下方**的独立一行（不在卡片内部），对标成熟 agent
 * 桌面端：选择器贴近输入框，不必跳设置页或拼斜杠命令。
 *
 * - 模型：选项来自 coding plans（`reflect_get_config` 解析，与 ModelsView
 *   同源）；切换走 `reflect_set_model(provider, model, label)` —— 后端写
 *   `[active].provider` + `[active].credential`（钉住该凭证）+ 条目/段级
 *   model → 热重载 provider 栈，协议不动。同 provider 的两个 plan 也能
 *   真正切换（v1.5 起 `active.credential` 钉住语义）。
 * - 选中态单一事实源是 `[active].credential`（后端钉住），不再靠
 *   "spec 后缀匹配 plan.model" 猜 —— 两个同 provider 空 model 的 plan
 *   以前会被兜底链挤回同一个选项，看起来「切换不生效」。
 * - 思考深度：`reflect_get_effort` 回读 + `reflect_set_effort` 设置
 *   （乐观更新 —— 协议无 effort 变更事件，读回仅在下次挂载时刷新）。
 * - 权限模式：agentStore 的 `permissionMode`（有 `permission_mode_changed`
 *   事件回读）+ `setPermissionMode`，提供 计划/询问/自动/Yolo 四个常用段。
 *
 * 数据获取用 useEffect + useState（同 ChatView 的 git diff 模式），
 * 不引入 QueryClient 依赖，保证 Composer 在任意测试挂载环境可用。
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { reflect_agent_status, reflect_get_config, reflect_set_model } from '@/utils/commands/config';
import { reflect_list_provider_models, type ProviderModelInfo } from '@/utils/commands/models';
import { reflect_get_effort, reflect_set_effort } from '@/utils/commands/permissions';
import { listPlans, readActiveCredential, readActiveProvider, type PlanEntry } from '@/features/settings/config/plans';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import s from './ComposerControls.module.css';

const EFFORTS = ['low', 'medium', 'high'] as const;
type Effort = (typeof EFFORTS)[number];

/** 常用权限模式子集（完整 7 段仍在 Settings → Permissions）。
 *  Yolo = `bubble`：core v1.3 安全基线已废除 blanket bypass
 *  （`SetPermissionMode(Bypass)` 一律降级 Prompt），bubble 是现存的
 *  "免打断"档 —— 自动批准非高危工具 + 非阻塞气泡通知，高危仍弹审批。 */
const PERMISSION_SEGMENTS = [
  { value: 'plan', labelKey: 'composer.controls.perm.plan', hintKey: 'composer.controls.planHint' },
  { value: 'prompt', labelKey: 'composer.controls.perm.ask', hintKey: 'composer.controls.askHint' },
  { value: 'accept_edits', labelKey: 'composer.controls.perm.auto', hintKey: 'composer.controls.autoHint' },
  { value: 'bubble', labelKey: 'composer.controls.perm.yolo', hintKey: 'composer.controls.yoloHint' },
] as const;

export function ComposerControls() {
  const { t } = useI18n();
  const permissionMode = useAgentStore((st) => st.permissionMode);
  const goalActive = useAgentStore((st) => st.goalActive);
  const setPermissionMode = useAgentStore((st) => st.setPermissionMode);
  const pushToast = useAgentStore((st) => st.pushToast);

  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [activeCredential, setActiveCredential] = useState('');
  const [currentSpec, setCurrentSpec] = useState('');
  const [switching, setSwitching] = useState(false);
  const [effort, setEffort] = useState<Effort>('low');
  // 接口拉取的模型列表(挂在 planKey 上)+ 拉取状态。
  const [apiModels, setApiModels] = useState<ProviderModelInfo[]>([]);
  const [apiModelsFor, setApiModelsFor] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // 配置 + 当前模型快照。`refresh` 在切换成功后再调 —— 配置已被后端
  // 改写(条目 model / active.credential),本地 plans 必须重读。
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const toml = await reflect_get_config();
      if (cancelled) return;
      setPlans(listPlans(toml));
      setActiveProvider(readActiveProvider(toml));
      setActiveCredential(readActiveCredential(toml));
    };
    refresh().catch(() => {/* 配置不可读时隐藏模型选择 */});
    reflect_agent_status()
      .then((status) => {
        if (cancelled) return;
        // 后端诚实化:has_model=false(无 provider 或无显式 model)时
        // status.model 是 "stub/test" 占位 —— 不展示,显示"未配置模型"。
        setCurrentSpec(status.has_model ? status.model : '');
      })
      .catch(() => {/* 状态不可读时显示占位 */});
    reflect_get_effort()
      .then((level) => {
        if (!cancelled) setEffort(normalizeEffort(level));
      })
      .catch(() => {/* 回读失败保持默认 */});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSwitchModel = async (value: string) => {
    if (switching) return;
    // 'model:<id>' = 从接口拉取的模型(挂到当前选中 plan 的端口上)。
    if (value.startsWith('model:')) {
      const target = selectedPlan;
      if (!target) return;
      setSwitching(true);
      try {
        const spec = await reflect_set_model(target.provider, value.slice('model:'.length), target.label);
        setCurrentSpec(spec);
        setActiveProvider(target.provider);
        setActiveCredential(target.label);
        await refreshPlans();
      } catch (e) {
        // 静默吞错会让「点了没反应」无法诊断 —— 后端拒绝(如未知
        // provider / 配置非法)必须可见。
        pushToast({
          kind: 'error',
          message: t('composer.controls.switchFailed', { msg: e instanceof Error ? e.message : String(e) }),
        });
      } finally {
        setSwitching(false);
      }
      return;
    }
    const plan = plans.find((p) => planKey(p) === value);
    if (!plan) return;
    setSwitching(true);
    try {
      const spec = await reflect_set_model(plan.provider, plan.model, plan.label);
      setCurrentSpec(spec);
      setActiveProvider(plan.provider);
      setActiveCredential(plan.label);
      await refreshPlans();
      // 钉住成功但该 plan 没有 model:请求仍无模型可用 —— 明示而非静默。
      if (!plan.model.trim()) {
        pushToast({
          kind: 'warn',
          message: t('composer.controls.pinnedNoModel', { label: plan.label }),
        });
      }
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('composer.controls.switchFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setSwitching(false);
    }
  };

  /** 切换成功后重读配置(后端已改写 active.credential / 条目 model)。 */
  const refreshPlans = async () => {
    const toml = await reflect_get_config();
    setPlans(listPlans(toml));
    setActiveProvider(readActiveProvider(toml));
    setActiveCredential(readActiveCredential(toml));
  };

  /** 对当前选中 plan 的 base_url + api_key 拉取可用模型列表。 */
  const onFetchModels = async () => {
    const plan = selectedPlan;
    if (!plan || !plan.apiKey.trim() || fetchingModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const res = await reflect_list_provider_models(plan.baseUrl.trim(), plan.apiKey.trim(), plan.provider);
      setApiModels(res.models);
      setApiModelsFor(planKey(plan));
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  const onSetEffort = (level: Effort) => {
    setEffort(level);
    void reflect_set_effort(level).catch(() => {
      // 乐观更新失败回滚读不到真值 —— 保持所选，下次挂载会对齐。
    });
  };

  const hasPlans = plans.length > 0;
  // 选中态单一事实源:`[active].credential` 钉住的 plan;未钉住时回落
  // 顶层隐式 default plan,再回落该 provider 首个 plan。
  const selectedPlan =
    (activeCredential
      ? plans.find((p) => p.provider === activeProvider && p.label === activeCredential)
      : undefined) ??
    plans.find((p) => p.provider === activeProvider && p.topLevel) ??
    plans.find((p) => p.provider === activeProvider);
  // 接口模型列表只在归属 plan 仍被选中时显示(避免展示别的 plan 的列表)。
  const showApiModels = apiModels.length > 0 && selectedPlan != null && apiModelsFor === planKey(selectedPlan);

  /** 能力标记后缀:接口返回了明确信息才标注,未返回由用户自行判断。 */
  const visionSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.visionTag')}` : v === false ? ` · ${t('common.noVisionTag')}` : '';

  /**
   * 免费标记后缀 —— 只在**已判定为免费**时标注。
   *
   * `null`(厂商没表态 + 规则没命中)不加标记:那是「未知」,不是「免费」。
   */
  const freeSuffix = (v: boolean | null) => (v === true ? ` · ${t('common.freeTag')}` : '');

  return (
    <div className={s.controlsBar}>
      <div className={s.left}>
        <label className={s.control}>
          <span className={s.controlLabel}>{t('composer.controls.model')}</span>
          <span className={s.modelRow}>
            <select
              className={s.controlSelect}
              value={selectedPlan ? planKey(selectedPlan) : ''}
              disabled={!hasPlans || switching}
              onChange={(event) => void onSwitchModel(event.target.value)}
              aria-label={t('composer.controls.modelAria')}
              data-testid="composer-model-select"
              title={currentSpec || t('composer.controls.modelConfigureHint')}
            >
              {!hasPlans && <option value="">{currentSpec || t('composer.controls.modelNone')}</option>}
              {hasPlans && !selectedPlan && (
                <option value="">
                  {currentSpec
                    ? t('composer.controls.modelCurrent', { spec: currentSpec })
                    : t('composer.controls.modelNone')}
                </option>
              )}
              {plans.map((plan) => (
                <option key={planKey(plan)} value={planKey(plan)}>
                  {plan.label} · {plan.model || plan.provider}
                </option>
              ))}
              {showApiModels && (
                <optgroup label={t('composer.controls.apiModelsGroup')}>
                  {apiModels.map((m) => (
                    <option key={m.id} value={`model:${m.id}`}>
                      {m.id}
                      {visionSuffix(m.supports_vision)}
                      {freeSuffix(m.is_free)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              className={s.fetchBtn}
              onClick={() => void onFetchModels()}
              disabled={fetchingModels || !hasPlans}
              title={modelsError ?? t('composer.controls.fetchModelsHint')}
              data-testid="composer-fetch-models"
            >
              <RefreshCw size={12} className={fetchingModels ? s.fetchSpin : undefined} />
            </button>
          </span>
        </label>

        <label className={s.control}>
          <span className={s.controlLabel}>{t('composer.controls.effort')}</span>
          <select
            className={s.controlSelect}
            value={effort}
            onChange={(event) => onSetEffort(normalizeEffort(event.target.value))}
            aria-label={t('composer.controls.effortAria')}
            data-testid="composer-effort-select"
          >
            {EFFORTS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={s.right}>
        {goalActive && (
          <span
            className={s.goalBadge}
            title={t('composer.goalBadge')}
            data-testid="composer-goal-badge"
          >
            🎯 {t('composer.goalBadgeLabel')}
          </span>
        )}
        <div className={s.permSwitch} role="radiogroup" aria-label={t('composer.controls.permissionAria')} data-testid="composer-permission-switch">
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

/** plan 的稳定 option key（provider + label 组合唯一）。 */
function planKey(plan: PlanEntry): string {
  return `${plan.provider}/${plan.label}`;
}

function normalizeEffort(value: string): Effort {
  return (EFFORTS as readonly string[]).includes(value) ? (value as Effort) : 'low';
}
