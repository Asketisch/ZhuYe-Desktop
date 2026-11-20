/**
 * ModelPicker —— 输入框右下角的模型选择器（zcode 式紧凑触发器）。
 *
 * 渲染在输入卡片**内部**的底栏右侧，与语音、发送按钮同一行。
 *
 * 选中态单一事实源：配置里的 `[active].group`（当前接入的**模型组 id**）
 * + `[active].credential`（组内被钉住的那条凭据 label）。切换一律走
 * `zhuye_set_model(group, model, label)` —— 后端改配置 + 热重载模型栈，
 * 协议不动。
 *
 * 选项来源只有「模型组」一层（「内置编码套餐」整层删除）：
 *  - 组本身 → `展示名 · 组模型`；
 *  - 组内凭据 → `展示名 · 凭据label`（凭据 label 参与钉住语义）；
 *  - 接口拉回的模型清单 → 最后一个 optgroup，落到当前组的组级默认模型。
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { zhuye_agent_status, zhuye_get_config, zhuye_set_model } from '@/utils/commands/config';
import { type ProviderModelInfo } from '@/utils/commands/models';
import { fetchProviderModels } from '@/logic/settings/config/modelCatalog';
import {
  groupDisplayLabel,
  listGroups,
  readActiveCredential,
  readActiveGroup,
  type GroupEntry,
} from '@/logic/models/modelGroups';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { formatTokens } from '@/utils/formatTokens';
import s from '@/render/composer/ModelPicker.module.css';

/** option value 前缀 —— 三类目标的稳定键。 */
const GROUP_VALUE = 'group:';
const CREDENTIAL_VALUE = 'cred:';
const MODEL_VALUE = 'model:';

export function ModelPicker() {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);

  // 模型组：配置里唯一的可切换目标集合。
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [activeCredential, setActiveCredential] = useState('');
  const [currentSpec, setCurrentSpec] = useState('');
  const [switching, setSwitching] = useState(false);
  // 接口拉取的模型列表 + 归属组 id + 拉取状态。
  const [apiModels, setApiModels] = useState<ProviderModelInfo[]>([]);
  const [apiModelsFor, setApiModelsFor] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  /** 切换成功后重读配置（后端已改写 active.group / active.credential / 组 model）。 */
  const refreshGroups = async () => {
    const toml = await zhuye_get_config();
    setGroups(listGroups(toml));
    setActiveGroupId(readActiveGroup(toml));
    setActiveCredential(readActiveCredential(toml));
  };

  // 配置 + 当前模型快照。
  useEffect(() => {
    let cancelled = false;
    refreshGroups()
      .then(() => {
        if (cancelled) return;
      })
      .catch(() => {/* 配置不可读时隐藏模型选择 */});
    zhuye_agent_status()
      .then((status) => {
        if (cancelled) return;
        // 后端诚实化:has_model=false(无模型组或无显式 model)时
        // status.model 是 "stub/test" 占位 —— 不展示,显示"未配置模型"。
        setCurrentSpec(status.has_model ? status.model : '');
      })
      .catch(() => {/* 状态不可读时显示占位 */});
    return () => {
      cancelled = true;
    };
  }, []);

  const hasGroups = groups.length > 0;
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );
  // 组内被钉住的凭据（`[active].credential`）；未钉住时为 null。
  const pinnedCredential = useMemo(
    () =>
      activeGroup && activeCredential
        ? activeGroup.credentials.find((c) => c.label === activeCredential) ?? null
        : null,
    [activeGroup, activeCredential],
  );
  // 选中目标的 key：钉住凭据 → 凭据项；否则 → 组项；都没有 → 空。
  const selectedKey = !activeGroup
    ? ''
    : pinnedCredential
      ? `${CREDENTIAL_VALUE}${activeGroup.id}:${pinnedCredential.label}`
      : `${GROUP_VALUE}${activeGroup.id}`;
  // 接口清单只在归属组仍被选中时显示（避免展示别的组的列表）。
  const showApiModels = apiModels.length > 0 && activeGroup !== null && apiModelsFor === activeGroup.id;

  // 当前生效目标的接入参数：钉住凭据优先用凭据自己的 base_url / api_key。
  const targetBaseUrl = (pinnedCredential?.baseUrl.trim() || activeGroup?.baseUrl.trim() || '');
  const targetApiKey = (pinnedCredential?.apiKey.trim() || activeGroup?.apiKey.trim() || '');
  const targetEndpoint = activeGroup?.endpoint ?? '';

  // active 是模型组 → 挂载/切换后自动拉取组内模型清单（前端 TTL memo,
  // 命中缓存零网络）,填进既有的 optgroup。
  useEffect(() => {
    if (!activeGroup || !targetBaseUrl) return;
    let cancelled = false;
    fetchProviderModels(targetBaseUrl, targetApiKey, targetEndpoint)
      .then((models) => {
        if (cancelled) return;
        setApiModels(models);
        setApiModelsFor(activeGroup.id);
      })
      .catch(() => {
        // 自动拉取失败保持静默:手动刷新按钮仍可用,错误在那里可见。
      });
    return () => {
      cancelled = true;
    };
  }, [activeGroup?.id, targetBaseUrl, targetApiKey, targetEndpoint]);

  /** 切换失败 —— 后端拒绝必须可见（静默吞错会让「点了没反应」无法诊断）。 */
  const reportSwitchFailure = (e: unknown) => {
    pushToast({
      kind: 'error',
      message: t('composer.controls.switchFailed', { msg: e instanceof Error ? e.message : String(e) }),
    });
  };

  const onSwitchModel = async (value: string) => {
    if (switching) return;

    // 'model:<id>' = 从接口拉取的模型 → 写当前组的组级默认模型。
    if (value.startsWith(MODEL_VALUE)) {
      const modelId = value.slice(MODEL_VALUE.length);
      if (!activeGroup) return;
      setSwitching(true);
      try {
        const spec = await zhuye_set_model(activeGroup.id, modelId);
        setCurrentSpec(spec);
        setActiveCredential('');
        await refreshGroups();
      } catch (e) {
        reportSwitchFailure(e);
      } finally {
        setSwitching(false);
      }
      return;
    }

    // 'cred:<组id>:<凭据label>' = 切到组内某条凭据（钉住该凭据）。
    if (value.startsWith(CREDENTIAL_VALUE)) {
      const rest = value.slice(CREDENTIAL_VALUE.length);
      const sep = rest.indexOf(':');
      if (sep <= 0) return;
      const groupId = rest.slice(0, sep);
      const label = rest.slice(sep + 1);
      const group = groups.find((g) => g.id === groupId);
      const credential = group?.credentials.find((c) => c.label === label);
      if (!group || !credential) return;
      setSwitching(true);
      try {
        const spec = await zhuye_set_model(group.id, credential.model, credential.label);
        setCurrentSpec(spec);
        setActiveGroupId(group.id);
        setActiveCredential(credential.label);
        await refreshGroups();
        // 钉住成功但该凭据没有 model:请求仍无模型可用 —— 明示而非静默。
        if (!credential.model.trim()) {
          pushToast({
            kind: 'warn',
            message: t('composer.controls.pinnedNoModel', { label: `${groupDisplayLabel(group)} · ${credential.label}` }),
          });
        }
      } catch (e) {
        reportSwitchFailure(e);
      } finally {
        setSwitching(false);
      }
      return;
    }

    // 'group:<组id>' = 切到模型组（以组当前默认模型生效）。
    if (value.startsWith(GROUP_VALUE)) {
      const group = groups.find((g) => g.id === value.slice(GROUP_VALUE.length));
      if (!group) return;
      setSwitching(true);
      try {
        const spec = await zhuye_set_model(group.id, group.model.trim());
        setCurrentSpec(spec);
        setActiveGroupId(group.id);
        setActiveCredential('');
        await refreshGroups();
        // 切到组但没有默认模型:请求仍无模型可用 —— 明示而非静默。
        if (!group.model.trim()) {
          pushToast({
            kind: 'warn',
            message: t('composer.controls.pinnedNoModel', { label: groupDisplayLabel(group) }),
          });
        }
      } catch (e) {
        reportSwitchFailure(e);
      } finally {
        setSwitching(false);
      }
    }
  };

  /** 对当前生效目标（组或钉住的凭据）的 base_url + api_key 拉取可用模型列表;
   * 刷新按钮强制绕过 TTL 缓存。 */
  const onFetchModels = async () => {
    if (!activeGroup || !targetBaseUrl || fetchingModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const models = await fetchProviderModels(
        targetBaseUrl,
        targetApiKey,
        targetEndpoint,
        { refresh: true },
      );
      setApiModels(models);
      setApiModelsFor(activeGroup.id);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  /** 能力标记后缀:接口返回了明确信息才标注,未返回由用户自行判断。 */
  const visionSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.visionTag')}` : v === false ? ` · ${t('common.noVisionTag')}` : '';

  /** 数值能力标记:窗口 / 输出上限(200K 上下文 · 32K 输出),未披露不标。 */
  const ctxSuffix = (v: number | null) => (v != null && v > 0 ? ` · ${formatTokens(v)} ${t('common.ctxTag')}` : '');
  const outSuffix = (v: number | null) => (v != null && v > 0 ? ` · ${formatTokens(v)} ${t('common.outTag')}` : '');

  /**
   * 免费标记后缀 —— 只在**已判定为免费**时标注。
   *
   * `null`(厂商没表态 + 规则没命中)不加标记:那是「未知」,不是「免费」。
   */
  const freeSuffix = (v: boolean | null) => (v === true ? ` · ${t('common.freeTag')}` : '');

  return (
    <span className={s.wrap} data-testid="composer-model-picker">
      <span className={s.modelRow}>
        <select
          className={s.modelTrigger}
          value={selectedKey}
          disabled={!hasGroups || switching}
          onChange={(event) => void onSwitchModel(event.target.value)}
          aria-label={t('composer.controls.modelAria')}
          data-testid="composer-model-select"
          title={currentSpec || t('composer.controls.modelConfigureHint')}
        >
          {!hasGroups && <option value="">{currentSpec || t('composer.controls.modelNone')}</option>}
          {hasGroups && !selectedKey && (
            <option value="">
              {currentSpec
                ? t('composer.controls.modelCurrent', { spec: currentSpec })
                : t('composer.controls.modelNone')}
            </option>
          )}
          {groups.map((group) => (
            <Fragment key={group.id}>
              <option value={`${GROUP_VALUE}${group.id}`}>
                {groupDisplayLabel(group)} · {group.model || group.endpoint}
              </option>
              {group.credentials.map((credential) => (
                <option key={`${CREDENTIAL_VALUE}${group.id}:${credential.label}`} value={`${CREDENTIAL_VALUE}${group.id}:${credential.label}`}>
                  {groupDisplayLabel(group)} · {credential.label}
                </option>
              ))}
            </Fragment>
          ))}
          {showApiModels && (
            <optgroup label={t('composer.controls.apiModelsGroup')}>
              {apiModels.map((m) => (
                <option key={m.id} value={`${MODEL_VALUE}${m.id}`}>
                  {m.id}
                  {ctxSuffix(m.context_window)}
                  {outSuffix(m.max_output_tokens)}
                  {visionSuffix(m.supports_vision)}
                  {freeSuffix(m.is_free)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <ChevronDown size={12} className={s.caret} aria-hidden="true" />
        <button
          type="button"
          className={s.fetchBtn}
          onClick={() => void onFetchModels()}
          disabled={fetchingModels || !hasGroups}
          title={modelsError ?? t('composer.controls.fetchModelsHint')}
          data-testid="composer-fetch-models"
        >
          <RefreshCw size={12} className={fetchingModels ? s.fetchSpin : undefined} />
        </button>
      </span>
    </span>
  );
}
