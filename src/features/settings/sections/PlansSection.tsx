/**
 * 编码计划（Coding Plans）设置区 —— plan 凭证的专属管理入口。
 *
 * 一个 plan = `[[<provider>.credentials]]` 中一个带 label 的条目
 * （api_key / base_url / model / quota），与后端凭证池一一对应；
 * 默认供应商 = `[active].provider`，凭证池内故障切换由上游 graph 层
 * 自动完成，额度耗尽后的跨供应商自动切换见 `stores/agent/planFailover.ts`。
 *
 * 与 ConfigForm 共享同一份 rawToml buffer（props 传入），由设置页统一的
 * Save 按钮落盘；后端 `reflect_save_config` 校验 + 热重载 provider 栈，
 * 新计划无需重启生效。
 */
import { useState } from 'react';
import { Plus, Trash2, Pencil, Zap, ShieldCheck, Gauge, RefreshCw } from 'lucide-react';
import { Badge, Button, Icon, Input, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_query_plan_quota,
  reflect_list_provider_models,
  reflect_test_provider_chat,
  type PlanQuotaSnapshot,
  type ProviderModelInfo,
} from '@/utils/commands';
import {
  AUTO_FAILOVER_PREF_KEY,
  isAutoFailoverEnabled,
} from '@/stores/agent/planFailover';
import {
  AUTO_COMPACT_PREF_KEY,
  isAutoCompactEnabled,
} from '@/stores/agent/autoCompact';
import {
  listPlans,
  maskKey,
  pickFailoverProvider,
  PLAN_PROVIDERS,
  QUOTA_SOURCES,
  readActiveProvider,
  readContextWindowForModel,
  removePlan,
  setActiveProvider,
  setContextWindowForModel,
  upsertPlan,
  type PlanEntry,
  type PlanProvider,
  type PlanQuota,
} from '../config/plans';
import s from '../SettingsView.module.css';

export interface PlansSectionProps {
  rawToml: string;
  onChange: (next: string) => void;
  /** 把变更立即落盘（reflect_save_config → 后端校验 + 热重载 provider 栈）。
   *  Plans 页的每个操作（保存/删除/设为默认）都是完整意图，不应要求用户
   *  再去点页面底部的总保存按钮 —— 否则模型选择器读到的仍是旧配置。 */
  onCommit?: (next: string) => void;
}

interface FormState {
  provider: PlanProvider;
  topLevel: boolean;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  weight: string;
  quota: PlanQuota;
  /** 最大上下文 tokens —— 落盘到 `[context_windows][model]`，供运行时
   * 仪表/工具与前端自动压缩使用；空 = 不设置。 */
  maxContext: string;
  /** 正在编辑的原始 label（区分"编辑既有条目"与"新增"）。 */
  editingLabel: string | null;
  /** 正在编辑的原始位置（label 改名 / 换 provider / 转 topLevel 时摘除旧块用）。 */
  editingProvider: PlanProvider | null;
  editingTopLevel: boolean;
}

const EMPTY_FORM: FormState = {
  provider: 'anthropic',
  topLevel: false,
  label: '',
  apiKey: '',
  baseUrl: '',
  model: '',
  weight: '',
  quota: { checkVia: '', windowSecs: '', maxTokens: '' },
  maxContext: '',
  editingLabel: null,
  editingProvider: null,
  editingTopLevel: false,
};

/** 单个 plan 的余量查询状态（key = `provider/label`）。 */
interface QuotaQueryState {
  loading: boolean;
  snapshot: PlanQuotaSnapshot | null;
}

export function PlansSection({ rawToml, onChange, onCommit }: PlansSectionProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showKey, setShowKey] = useState(false);
  const [autoFailover, setAutoFailover] = useState(isAutoFailoverEnabled);
  const [autoCompact, setAutoCompact] = useState(isAutoCompactEnabled);
  const [quotaQueries, setQuotaQueries] = useState<Record<string, QuotaQueryState>>({});
  // 模型列表拉取（按接入端口缓存；编辑表单内 base_url + api_key 即可试查）。
  const [formModels, setFormModels] = useState<ProviderModelInfo[] | null>(null);
  const [formModelsProvider, setFormModelsProvider] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // 连通性测试:connection = 纯 API(models 列表,零 token);chat = 发送「你好」。
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [testingChat, setTestingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const plans = listPlans(rawToml);
  const activeProvider = readActiveProvider(rawToml);
  const backup = pickFailoverProvider(rawToml, activeProvider || 'x');

  const patch = (p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p }));

  /**
   * 该接入端口是否允许**留空 api_key**（免 Key 端点）。
   *
   * OpenAI 兼容端点可以免 Key —— 免费模型池就是这种端点：空 key 时后端
   * **不发** Authorization 头（与 `reflect-llm` 的 OpenAIClient 同口径）。
   * Anthropic 协议没有免 Key 形态，仍要求 key。
   */
  const keylessAllowed = form.provider === 'openai';

  /** 当前表单是否「填得够用」（keyless 时 api_key 可空）。 */
  const hasEndpoint = () => form.baseUrl.trim().length > 0;
  const hasCredentials = () => form.apiKey.trim().length > 0 || keylessAllowed;

  const onSavePlan = () => {
    if (!form.label.trim() && !form.topLevel) return;
    const model = form.model.trim();
    const nextLabel = form.topLevel ? 'default' : form.label.trim();
    let next = rawToml;
    // 编辑中改名 / 换 provider / 转 topLevel：upsertPlan 按"新位置"定位,
    // 找不到旧块会追加新条目导致重复 —— 先摘除旧位置的块。
    if (form.editingLabel !== null) {
      const oldProvider = form.editingProvider ?? form.provider;
      const moved =
        form.editingLabel !== nextLabel ||
        oldProvider !== form.provider ||
        form.editingTopLevel !== form.topLevel;
      if (moved && !form.editingTopLevel) {
        next = removePlan(next, oldProvider, form.editingLabel);
      } else if (moved && form.editingTopLevel) {
        // 顶层隐式条目（label 固定 default）位置变化 → 清旧顶层 api_key。
        next = removePlan(next, oldProvider, form.editingLabel);
      }
    }
    next = upsertPlan(next, {
      provider: form.provider,
      topLevel: form.topLevel,
      label: nextLabel,
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
      model,
      weight: form.weight.trim(),
      quota: form.quota.checkVia ? form.quota : null,
    });
    // 最大上下文 → `[context_windows][model]`（runtime 级联进
    // session_configured.context_window_size；空值 = 清除覆盖）。
    if (model) next = setContextWindowForModel(next, model, form.maxContext.trim());
    onChange(next);
    onCommit?.(next);
    setForm(EMPTY_FORM);
  };

  const onEdit = (plan: PlanEntry) => {
    setForm({
      provider: plan.provider,
      topLevel: plan.topLevel,
      label: plan.label,
      apiKey: plan.apiKey,
      baseUrl: plan.baseUrl,
      model: plan.model,
      weight: plan.weight,
      quota: plan.quota ?? { checkVia: '', windowSecs: '', maxTokens: '' },
      maxContext: readContextWindowForModel(rawToml, plan.model),
      editingLabel: plan.label,
      editingProvider: plan.provider,
      editingTopLevel: plan.topLevel,
    });
  };

  const onDelete = (plan: PlanEntry) => {
    const next = removePlan(rawToml, plan.provider, plan.label);
    onChange(next);
    onCommit?.(next);
    if (form.editingLabel === plan.label) setForm(EMPTY_FORM);
  };

  /** 手动查询该 plan 的用量（走厂商用量 API，端点与 cc-switch 一致；仅对
   * 配置了用量源的 coding plan / token plan 开放）。 */
  const onQueryQuota = async (plan: PlanEntry) => {
    const checkVia = plan.quota?.checkVia;
    if (!checkVia) return;
    const key = `${plan.provider}/${plan.label}`;
    setQuotaQueries((prev) => ({ ...prev, [key]: { loading: true, snapshot: null } }));
    let snapshot: PlanQuotaSnapshot;
    try {
      snapshot = await reflect_query_plan_quota(plan.baseUrl, plan.apiKey, checkVia);
    } catch (e) {
      // invoke 本身被拒（命令缺失 / 后端异常）→ 与查询失败同形展示。
      snapshot = { success: false, error: String(e), utilization: null, remaining_tokens: null, max_tokens: null, resets_at: null };
    }
    setQuotaQueries((prev) => ({ ...prev, [key]: { loading: false, snapshot } }));
  };

  /** 从接入端口拉取可用模型列表（需要已填 base_url + api_key）。 */
  const onFetchModels = async () => {
    if (!hasCredentials() || !hasEndpoint() || fetchingModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const res = await reflect_list_provider_models(form.baseUrl.trim(), form.apiKey.trim(), form.provider);
      setFormModels(res.models);
      setFormModelsProvider(form.provider);
    } catch (e) {
      setFormModels(null);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  /** 纯 API 连通测试:拉一次模型列表,不消耗 token。 */
  const onTestConnection = async () => {
    if (!hasCredentials() || !hasEndpoint() || testingConnection) return;
    setTestingConnection(true);
    setConnectionOk(null);
    try {
      const res = await reflect_list_provider_models(form.baseUrl.trim(), form.apiKey.trim(), form.provider);
      setConnectionOk(true);
      setFormModels(res.models);
      setFormModelsProvider(form.provider);
    } catch {
      setConnectionOk(false);
    } finally {
      setTestingConnection(false);
    }
  };

  /** 发送「你好」测试消息(无 system / 无 tools,max_tokens=32)。 */
  const onTestChat = async () => {
    if (!hasCredentials() || !hasEndpoint() || !form.model.trim() || testingChat) return;
    setTestingChat(true);
    setChatReply(null);
    setChatError(null);
    try {
      const res = await reflect_test_provider_chat(
        form.baseUrl.trim(),
        form.apiKey.trim(),
        form.provider,
        form.model.trim(),
      );
      setChatReply(res.reply);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingChat(false);
    }
  };

  /** 能力标记后缀:接口返回了明确信息才标注,未返回由用户自行判断。 */
  const visionSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.visionTag')}` : v === false ? ` · ${t('common.noVisionTag')}` : '';

  const onToggleAutoFailover = (enabled: boolean) => {
    setAutoFailover(enabled);
    try {
      localStorage.setItem(AUTO_FAILOVER_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // localStorage 不可用（隐私模式等）—— UI 状态仍然生效到本会话。
    }
  };

  const onToggleAutoCompact = (enabled: boolean) => {
    setAutoCompact(enabled);
    try {
      localStorage.setItem(AUTO_COMPACT_PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      // localStorage 不可用（隐私模式等）—— UI 状态仍然生效到本会话。
    }
  };

  return (
    <section data-testid="plans-section">
      <h3 className={s.sectionTitle}>{t('settings.plans.title')}</h3>
      <p className={s.sectionDesc}>{t('settings.plans.desc')}</p>

      {/* 默认供应商（[active].provider） */}
      <h4 className={s.sectionTitle}>{t('settings.plans.defaultProvider')}</h4>
      <div className={s.permGrid}>
        {PLAN_PROVIDERS.map((provider) => (
          <button
            key={provider}
            className={s.permCard}
            data-active={provider === activeProvider || undefined}
            data-testid={`provider-default-${provider}`}
            onClick={() => {
              const next = setActiveProvider(rawToml, provider);
              onChange(next);
              onCommit?.(next);
            }}
          >
            <div className={s.permCardHeader}>
              <Badge variant={provider === activeProvider ? 'success' : 'neutral'} solid>
                {provider === activeProvider ? t('settings.plans.defaultBadge') : provider}
              </Badge>
              {provider !== activeProvider && <span className={s.providerName}>{provider}</span>}
            </div>
            <p className={s.permDesc}>
              {provider === activeProvider
                ? t('settings.plans.currentDefault')
                : t('settings.plans.clickToSet')}
            </p>
          </button>
        ))}
      </div>

      {/* Plan 列表 */}
      <h4 className={s.sectionTitle}>{t('settings.plans.list')}</h4>
      {plans.length === 0 && <p className={s.sectionDesc}>{t('settings.plans.empty')}</p>}
      <div className={s.providerFields}>
        {plans.map((plan) => {
          const quotaKey = `${plan.provider}/${plan.label}`;
          const quota = quotaQueries[quotaKey];
          return (
            <div key={quotaKey} className={s.providerCard}>
              <div className={s.providerHeader}>
                <span className={s.providerName}>
                  {plan.label}
                  {plan.topLevel && (
                    <Badge variant="neutral">{t('settings.plans.topLevelBadge')}</Badge>
                  )}
                </span>
                <Badge variant={plan.provider === activeProvider ? 'success' : 'info'}>{plan.provider}</Badge>
              </div>
              <div className={s.planMeta}>
                {plan.apiKey ? (
                  <code>{maskKey(plan.apiKey)}</code>
                ) : (
                  <Badge variant="neutral">{t('settings.plans.keylessBadge')}</Badge>
                )}
                {plan.model && <span>{plan.model}</span>}
                {plan.model && readContextWindowForModel(rawToml, plan.model) && (
                  <Badge variant="neutral">
                    ctx {Number(readContextWindowForModel(rawToml, plan.model)).toLocaleString()}
                  </Badge>
                )}
                {plan.baseUrl && <span className={s.planUrl}>{plan.baseUrl}</span>}
                {plan.quota?.checkVia && (
                  <Badge variant="warning">
                    <Icon icon={Zap} size={10} /> {plan.quota.checkVia}
                  </Badge>
                )}
              </div>
              {quota?.snapshot && (
                <div
                  className={s.planQuotaResult}
                  data-failed={quota.snapshot.success ? undefined : ''}
                  data-testid={`quota-result-${plan.label}`}
                >
                  {quota.snapshot.success ? (
                    <>
                      {quota.snapshot.utilization != null && (
                        <span>
                          {t('settings.plans.quotaUsed', {
                            percent: quota.snapshot.utilization.toFixed(1),
                          })}
                        </span>
                      )}
                      {quota.snapshot.remaining_tokens != null && (
                        <span>
                          {t('settings.plans.quotaRemaining', {
                            tokens: quota.snapshot.remaining_tokens.toLocaleString(),
                          })}
                        </span>
                      )}
                      {quota.snapshot.resets_at && (
                        <span>
                          {t('settings.plans.quotaResets', {
                            time: new Date(quota.snapshot.resets_at).toLocaleString(),
                          })}
                        </span>
                      )}
                    </>
                  ) : (
                    <span>
                      {t('settings.plans.quotaFailed', { error: quota.snapshot.error ?? '' })}
                    </span>
                  )}
                </div>
              )}
              <div className={s.planActions}>
                {plan.quota?.checkVia && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={quota?.loading}
                    data-testid={`quota-query-${plan.label}`}
                    onClick={() => void onQueryQuota(plan)}
                  >
                    <Icon icon={Gauge} size={12} />{' '}
                    {quota?.loading ? t('settings.plans.querying') : t('settings.plans.queryQuota')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => onEdit(plan)}>
                  <Icon icon={Pencil} size={12} /> {t('settings.plans.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(plan)}>
                  <Icon icon={Trash2} size={12} /> {t('settings.plans.delete')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {backup && (
        <p className={s.hint}>
          <Icon icon={ShieldCheck} size={12} /> {t('settings.plans.backupHint', { provider: backup })}
        </p>
      )}

      {/* 新增 / 编辑表单 */}
      <h4 className={s.sectionTitle}>
        {form.editingLabel ? t('settings.plans.editTitle') : t('settings.plans.addTitle')}
      </h4>
      <div className={s.providerFields}>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.provider')}</label>
          <Select
            value={form.provider}
            aria-label={t('settings.plans.provider')}
            onChange={(e) => patch({ provider: e.target.value as PlanProvider, topLevel: false })}
          >
            {PLAN_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.name')}</label>
          <Input
            value={form.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder={t('settings.plans.namePlaceholder')}
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.apiKey')}</label>
          <Input
            type={showKey ? 'text' : 'password'}
            value={form.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="sk-…"
          />
          <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
            {showKey ? t('settings.config.hide') : t('settings.config.show')}
          </Button>
          {keylessAllowed && (
            <span className={s.fieldHint}>{t('settings.plans.apiKeyKeylessHint')}</span>
          )}
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.baseUrl')}</label>
          <Input
            value={form.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder="https://open.bigmodel.cn/api/anthropic"
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.model')}</label>
          <span className={s.modelFetchRow}>
            <Input
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="claude-sonnet-4 / glm-4.7 …"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={fetchingModels || !hasCredentials() || !hasEndpoint()}
              data-testid="plans-fetch-models"
              title={modelsError ?? t('settings.plans.fetchModels')}
              onClick={() => void onFetchModels()}
            >
              <Icon icon={RefreshCw} size={12} />{' '}
              {fetchingModels ? t('settings.plans.fetchingModels') : t('settings.plans.fetchModels')}
            </Button>
          </span>
          {formModels && formModelsProvider === form.provider && !modelsError && (
            <span className={s.fetchHint}>
              {t('settings.plans.modelsFetched', { count: String(formModels.length) })}
            </span>
          )}
          {modelsError && <span className={s.fetchHint} data-failed>{modelsError}</span>}
          {/* 拉取结果必须是显式可点击列表:WKWebView(macOS Tauri)对
              <datalist> 建议下拉支持不可靠,拉取后无任何可选入口。 */}
          {formModels && formModelsProvider === form.provider && !modelsError && formModels.length > 0 && (
            <div
              className={s.modelOptions}
              role="listbox"
              aria-label={t('settings.plans.modelsGroup')}
              data-testid="plans-model-options"
            >
              {formModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={form.model === m.id}
                  className={s.modelOption}
                  data-active={form.model === m.id || undefined}
                  onClick={() => patch({ model: m.id })}
                  title={`${m.id}${visionSuffix(m.supports_vision)}`}
                >
                  <span className={s.modelOptionId}>{m.id}</span>
                  <span className={s.modelOptionMeta}>
                    {m.display_name && m.display_name !== m.id ? m.display_name : ''}
                    {visionSuffix(m.supports_vision)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.connectionTest')}</label>
          <span className={s.modelFetchRow}>
            <Button
              variant="ghost"
              size="sm"
              disabled={testingConnection || !hasCredentials() || !hasEndpoint()}
              data-testid="plans-test-connection"
              title={t('settings.plans.testConnectionHint')}
              onClick={() => void onTestConnection()}
            >
              {testingConnection ? t('settings.plans.testing') : t('settings.plans.testConnection')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={testingChat || !hasCredentials() || !hasEndpoint() || !form.model.trim()}
              data-testid="plans-test-chat"
              title={t('settings.plans.testChatHint')}
              onClick={() => void onTestChat()}
            >
              {testingChat ? t('settings.plans.testing') : t('settings.plans.testChat')}
            </Button>
          </span>
        </div>
        {connectionOk != null && (
          <p className={s.fetchHint} data-failed={connectionOk ? undefined : ''}>
            {connectionOk
              ? t('settings.plans.testConnectionOk')
              : t('settings.plans.testConnectionFailed')}
          </p>
        )}
        {chatReply != null && (
          <p className={s.fetchHint} data-testid="plans-chat-reply">
            {t('settings.plans.testChatReply', { reply: chatReply || '…' })}
          </p>
        )}
        {chatError && (
          <p className={s.fetchHint} data-failed>
            {t('settings.plans.testChatFailed', { error: chatError })}
          </p>
        )}
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.maxContext')}</label>
          <Input
            value={form.maxContext}
            onChange={(e) => patch({ maxContext: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="200000"
            inputMode="numeric"
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.quotaVia')}</label>
          <Select
            value={form.quota.checkVia}
            aria-label={t('settings.plans.quotaVia')}
            onChange={(e) => patch({ quota: { ...form.quota, checkVia: e.target.value } })}
          >
            {QUOTA_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src || t('settings.plans.quotaOff')}
              </option>
            ))}
          </Select>
        </div>
        {form.quota.checkVia && (
          <>
            <div className={s.fieldRow}>
              <label className={s.fieldLabel}>{t('settings.plans.windowSecs')}</label>
              <Input
                value={form.quota.windowSecs}
                onChange={(e) => patch({ quota: { ...form.quota, windowSecs: e.target.value } })}
                placeholder="2592000"
              />
            </div>
            <div className={s.fieldRow}>
              <label className={s.fieldLabel}>{t('settings.plans.maxTokens')}</label>
              <Input
                value={form.quota.maxTokens}
                onChange={(e) => patch({ quota: { ...form.quota, maxTokens: e.target.value } })}
                placeholder="120000000"
              />
            </div>
          </>
        )}
        <div className={s.planActions}>
          <Button variant="primary" size="sm" onClick={onSavePlan} disabled={!form.topLevel && !form.label.trim()}>
            <Icon icon={Plus} size={12} /> {t('settings.plans.savePlan')}
          </Button>
          {form.editingLabel && (
            <Button variant="ghost" size="sm" onClick={() => setForm(EMPTY_FORM)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </div>

      {/* 额度耗尽自动切换 */}
      <h4 className={s.sectionTitle}>{t('settings.plans.autoFailover')}</h4>
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoFailover}
          onChange={(e) => onToggleAutoFailover(e.target.checked)}
        />
        <span className={s.fieldLabel}>{t('settings.plans.autoFailoverLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.plans.autoFailoverDesc')}</p>

      {/* 按最大上下文自动压缩 */}
      <label className={s.fieldRow}>
        <input
          type="checkbox"
          checked={autoCompact}
          onChange={(e) => onToggleAutoCompact(e.target.checked)}
          data-testid="plans-auto-compact"
        />
        <span className={s.fieldLabel}>{t('settings.plans.autoCompactLabel')}</span>
      </label>
      <p className={s.sectionDesc}>{t('settings.plans.autoCompactDesc')}</p>
    </section>
  );
}
