/**
 * 模型组详情面板 —— 主从布局的「从」列（`[[model_group]]` 条目编辑器）。
 *
 * 模型组是**唯一**的模型接入单元：组 = 端点（endpoint）+ 端点配置
 * （base_url / api_key / model）+ 组内凭据池（`[[model_group.credentials]]`）。
 * 保存后**自动拉取**组内模型清单（前端 5 分钟 TTL memo，命中缓存零网络），
 * 点选模型即写为组默认模型并即时落盘。
 *
 * 布局对齐模型设置页：详情头（monogram + 名称 + 设为默认开关 + 删除）
 * → 连接配置（线格式 / Base URL / API Key）→ 模型列表（GroupModelList）→
 * 折叠「高级配置」（GroupAdvancedFields）与「组内凭据」→ 底部操作。
 *
 * 共享同一份 rawToml buffer（props 传入），与设置页统一的 onCommit
 * 通道一致 —— 每个保存/点选都是完整意图，立即落盘。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button, Icon, Input, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_test_provider_chat, type ProviderModelInfo } from '@/utils/commands';
import { fetchProviderModels } from '@/logic/settings/config/modelCatalog';
import {
  GROUP_ENDPOINTS,
  groupDisplayLabel,
  isValidGroupId,
  listGroups,
  setGroupContextWindow,
  removeGroup,
  upsertGroup,
  type GroupCredentialEntry,
  type GroupEndpoint,
  type GroupEntry,
} from '../config/groups';
import { GroupCredentialsEditor } from './GroupCredentialsEditor';
import { GroupModelList } from './GroupModelList';
import { GroupAdvancedFields } from './GroupAdvancedFields';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupDetailProps {
  /** 选中的组；null = 新增模式（空表单）。 */
  group: GroupEntry | null;
  rawToml: string;
  onChange: (next: string) => void;
  /** 把变更立即落盘（zhuye_save_config → 后端校验 + 热重载 provider 栈）。 */
  onCommit?: (next: string) => void;
  /** 当前默认组 id（设为默认开关的选中态）。 */
  activeGroup: string | null;
  /** 设为默认（父级 setActiveGroup + 落盘）。 */
  onSetDefault: (id: string) => void;
  /** 删除组（父级 removeGroup + 落盘 + 选中回落）。 */
  onDelete: (id: string) => void;
  /** 保存成功后让父级把选中切到该组 id（新增 / 改名都靠它跟随）。 */
  onSaved: (id: string) => void;
}

/** 详情表单状态 —— 数值字段全部用 string 承载（空串 = 未设置）。 */
export interface FormState {
  id: string;
  label: string;
  /** 线格式（openai / anthropic / ollama）—— 存量配置里的未知端点原样保留。 */
  endpoint: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  responsesApi: boolean;
  timeoutSecs: string;
  temperature: string;
  maxTokens: string;
  keepAliveSecs: string;
  numCtx: string;
  numGpu: string;
  /** 组默认模型的上下文窗口（tokens；空 = 引擎内置回退表）。写
   * `[context_windows]` 表,不进 [[model_group]] 块。 */
  contextWindow: string;
  credentials: GroupCredentialEntry[];
}

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  endpoint: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
  responsesApi: false,
  timeoutSecs: '',
  temperature: '',
  maxTokens: '',
  keepAliveSecs: '',
  numCtx: '',
  numGpu: '',
  contextWindow: '',
  credentials: [],
};

/** 表单字符串 → 数值（空串 = 未设置）。 */
function numOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** 组条目 → 表单状态（数值 null → 空串）。 */
function fromGroup(group: GroupEntry): FormState {
  return {
    id: group.id,
    label: group.label,
    endpoint: group.endpoint,
    apiKey: group.apiKey,
    baseUrl: group.baseUrl,
    model: group.model,
    responsesApi: group.responsesApi,
    timeoutSecs: group.timeoutSecs == null ? '' : String(group.timeoutSecs),
    temperature: group.temperature == null ? '' : String(group.temperature),
    maxTokens: group.maxTokens == null ? '' : String(group.maxTokens),
    keepAliveSecs: group.keepAliveSecs == null ? '' : String(group.keepAliveSecs),
    numCtx: group.numCtx == null ? '' : String(group.numCtx),
    numGpu: group.numGpu == null ? '' : String(group.numGpu),
    contextWindow: group.contextWindow == null ? '' : String(group.contextWindow),
    credentials: group.credentials.map((c) => ({ ...c })),
  };
}

export function GroupDetail({
  group,
  rawToml,
  onChange,
  onCommit,
  activeGroup,
  onSetDefault,
  onDelete,
  onSaved,
}: GroupDetailProps) {
  const { t } = useI18n();
  // 表单身份键:组 id 或新增模式。仅随身份重载,无关的 rawToml 变化
  // (如切默认组、别处保存)不会冲掉正在编辑的内容。
  const formKey = group?.id ?? '__new__';
  const [form, setForm] = useState<FormState>(() => (group ? fromGroup(group) : EMPTY_FORM));
  const [showKey, setShowKey] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  // 自动拉取的模型清单（保存 / 选中组后自动触发）。
  const [formModels, setFormModels] = useState<ProviderModelInfo[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // 连通性测试（发送「你好」，无 system / 无 tools）。
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [testingChat, setTestingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p }));

  // openai 兼容端点可免 Key（空 key 不发 Authorization 头）；anthropic / ollama 需要 key。
  const keylessAllowed = form.endpoint === 'openai';
  const hasEndpoint = form.baseUrl.trim().length > 0;
  const hasUsableKey = form.apiKey.trim().length > 0 || keylessAllowed;

  /** 拉取组端点的模型清单（force = 绕过 TTL 缓存）。显式传端点三元组：
   * 「选中既有组」的自动拉取发生在 setForm 生效之前,不能读闭包里的
   * 旧 form。同 key 的在途去重 / TTL 缓存由 fetchProviderModels 承担,
   * 这里不做全局在飞守卫 —— 全局守卫会把「A 组拉取在飞时保存 B 组」
   * 的 B 拉取误吞掉。 */
  const fetchFor = async (baseUrl: string, apiKey: string, endpoint: string, force = false) => {
    if (!baseUrl.trim() || (apiKey.trim() === '' && endpoint !== 'openai')) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const models = await fetchProviderModels(baseUrl.trim(), apiKey.trim(), endpoint, { refresh: force });
      setFormModels(models);
    } catch (e) {
      setFormModels(null);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  // 选中组变化（含进入/退出新增模式）→ 重载表单 + 清空临时状态 + 自动拉模型。
  useEffect(() => {
    setForm(group ? fromGroup(group) : EMPTY_FORM);
    setIdError(null);
    setFormModels(null);
    setModelsError(null);
    setChatReply(null);
    setChatError(null);
    if (group) void fetchFor(group.baseUrl, group.apiKey, group.endpoint);
    // 仅随选中组身份重载;fetchFor / group 不入 deps（见上方注释）。
  }, [formKey]);

  /** 表单状态 → 组条目（数值字段空 = 未设置）。 */
  const toGroup = (id: string, model = form.model): GroupEntry => ({
    id,
    label: form.label.trim(),
    endpoint: form.endpoint,
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim(),
    model: model.trim(),
    responsesApi: form.responsesApi,
    timeoutSecs: numOrNull(form.timeoutSecs),
    temperature: numOrNull(form.temperature),
    maxTokens: numOrNull(form.maxTokens),
    keepAliveSecs: numOrNull(form.keepAliveSecs),
    numCtx: numOrNull(form.numCtx),
    numGpu: numOrNull(form.numGpu),
    contextWindow: numOrNull(form.contextWindow),
    credentials: form.credentials,
  });

  /** 保存组 → 即时落盘 → 自动拉取模型清单 → 选中跟随新 id（新增 / 改名共用）。
   * 选中跟随会触发 formKey 重载,重载内容 == 已保存内容（幂等）,
   * 模型拉取命中 TTL 缓存零网络。 */
  const onSaveGroup = () => {
    const id = form.id.trim();
    if (!isValidGroupId(id)) {
      setIdError(t('settings.groups.invalidId'));
      return;
    }
    // id 唯一性:与「其他」组冲突时拒绝(编辑自身除外)。
    const others = listGroups(rawToml).filter((g) => g.id !== group?.id);
    if (others.some((g) => g.id === id)) {
      setIdError(t('settings.groups.duplicateId', { id }));
      return;
    }
    // 组内凭据的 label 必填(引擎侧 CredentialConfig.label 必填)。
    if (form.credentials.some((c) => !c.label.trim())) {
      setIdError(t('settings.groups.credentialLabelRequired'));
      return;
    }
    setIdError(null);
    let next = rawToml;
    // 改名:upsert 按「新 id」定位,找不到旧块会追加新条目导致重复 ——
    // 先摘除旧位置的块。
    if (group && group.id !== id) {
      next = removeGroup(next, group.id);
    }
    next = upsertGroup(next, toGroup(id));
    // 上下文窗口独立落 `[context_windows]` 表(键 = 组默认模型名)。
    next = setGroupContextWindow(next, toGroup(id).model, numOrNull(form.contextWindow));
    onChange(next);
    onCommit?.(next);
    // 保存后自动拉取:端点配齐才拉,否则留给下次(输入 base_url/key 后)。
    void fetchFor(form.baseUrl, form.apiKey, form.endpoint);
    onSaved(id);
  };

  /** 点选模型 → 写为组默认模型并即时落盘。新增模式只填表单字段
   * （避免把半截表单提前 upsert 成一条残缺的组条目）。 */
  const onPickModel = (modelId: string) => {
    patch({ model: modelId });
    if (!group) return;
    const next = upsertGroup(rawToml, toGroup(group.id, modelId));
    onChange(next);
    onCommit?.(next);
  };

  const onTestChat = async () => {
    if (!hasUsableKey || !hasEndpoint || !form.model.trim() || testingChat) return;
    setTestingChat(true);
    setChatReply(null);
    setChatError(null);
    try {
      const res = await zhuye_test_provider_chat(
        form.baseUrl.trim(),
        form.apiKey.trim(),
        form.endpoint,
        form.model.trim(),
      );
      setChatReply(res.reply);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingChat(false);
    }
  };

  // 端点下拉：标准三选一 + 存量配置里的未知端点（避免保存时被静默改写）。
  const endpointOptions = GROUP_ENDPOINTS.includes(form.endpoint as GroupEndpoint)
    ? GROUP_ENDPOINTS
    : [form.endpoint, ...GROUP_ENDPOINTS];

  return (
    <div className={s.gDetail} data-testid="groups-editor">
      {/* 详情头:monogram + 名称/元信息 + 设为默认开关 + 删除 */}
      <div className={s.gDetailHead}>
        {group ? (
          <>
            <span className={s.gNavAvatar} aria-hidden="true">
              {(groupDisplayLabel(group).trim()[0] ?? '?').toUpperCase()}
            </span>
            <span className={s.gDetailTitle}>
              <span className={s.gDetailName}>{groupDisplayLabel(group)}</span>
              <span className={s.gDetailSub}>
                <code>{group.id}</code>
                {group.baseUrl && <span className={s.gDetailUrl}>{group.baseUrl}</span>}
              </span>
            </span>
            <span className={s.gSwitchRow}>
              <span className={s.gSwitchLabel}>{t('settings.groups.defaultBadge')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={group.id === activeGroup}
                aria-label={t('settings.groups.setDefault')}
                data-testid={`group-default-${group.id}`}
                className={`sw${group.id === activeGroup ? ' on' : ''}`}
                onClick={() => {
                  if (group.id !== activeGroup) onSetDefault(group.id);
                }}
              >
                <span />
              </button>
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('settings.groups.delete')}
              title={t('settings.groups.delete')}
              data-testid={`group-delete-${group.id}`}
              onClick={() => onDelete(group.id)}
            >
              <Icon icon={Trash2} size={13} />
            </Button>
          </>
        ) : (
          <span className={s.gDetailTitle}>
            <span className={s.gDetailName}>{t('settings.groups.addTitle')}</span>
            <span className={s.gDetailSub}>{t('settings.groups.desc')}</span>
          </span>
        )}
      </div>

      <div className={s.providerFields}>
        {/* 连接配置:线格式 / Base URL / API Key —— 统一模型设置页的字段顺序 */}
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.endpoint')}</label>
          <Select
            value={form.endpoint}
            aria-label={t('settings.groups.endpoint')}
            onChange={(e) => {
              patch({ endpoint: e.target.value });
              setFormModels(null);
              setModelsError(null);
            }}
          >
            {endpointOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.baseUrl')}</label>
          <Input
            value={form.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder="https://open.bigmodel.cn/api/paas/v4"
            aria-label={t('settings.groups.baseUrl')}
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.apiKey')}</label>
          <span className={s.modelFetchRow}>
            <Input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="sk-…"
              aria-label={t('settings.groups.apiKey')}
            />
            <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? t('settings.config.hide') : t('settings.config.show')}
            </Button>
          </span>
          {keylessAllowed && (
            <span className={s.fieldHint}>{t('settings.groups.apiKeyKeylessHint')}</span>
          )}
        </div>

        {/* 身份:展示名 + 组 ID(改名走 remove+upsert,见 onSaveGroup) */}
        <div className={s.gFieldPair}>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel}>{t('settings.groups.label')}</label>
            <Input
              value={form.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder={t('settings.groups.labelPlaceholder')}
              aria-label={t('settings.groups.label')}
            />
          </div>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel}>{t('settings.groups.id')}</label>
            <Input
              value={form.id}
              onChange={(e) => patch({ id: e.target.value.replace(/\s/g, '') })}
              placeholder="bigmodel"
              aria-label={t('settings.groups.id')}
              aria-invalid={idError ? true : undefined}
            />
          </div>
        </div>
        {idError && (
          <p className={s.fetchHint} data-failed>
            {idError}
          </p>
        )}

        {/* 模型列表:默认模型输入 + 自动拉取清单(点选行 = 设为组默认模型) */}
        <GroupModelList
          model={form.model}
          onModelChange={(model) => patch({ model })}
          models={formModels}
          fetching={fetchingModels}
          modelsError={modelsError}
          canFetch={hasUsableKey && hasEndpoint}
          onFetch={() => void fetchFor(form.baseUrl, form.apiKey, form.endpoint, true)}
          onPick={onPickModel}
        />

        {/* 高级配置(折叠)。key 随选中组重挂 —— 折叠态跟随组重置,凭据池同理。 */}
        <Fold key={`${formKey}-advanced`} label={t('settings.groups.advanced')}>
          <GroupAdvancedFields form={form} patch={patch} />
        </Fold>

        {/* 组内凭据(折叠):原「编码套餐」层下沉到这里 */}
        <Fold
          key={`${formKey}-credentials`}
          label={t('settings.groups.credentialsTitle')}
          defaultOpen={(group?.credentials.length ?? 0) > 0}
        >
          <GroupCredentialsEditor
            credentials={form.credentials}
            onChange={(credentials) => patch({ credentials })}
          />
        </Fold>

        {/* 连通性测试:发「你好」,无 system 无 tools(最多 32 tokens) */}
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.testChat')}</label>
          <span className={s.modelFetchRow}>
            <Button
              variant="ghost"
              size="sm"
              disabled={testingChat || !hasUsableKey || !hasEndpoint || !form.model.trim()}
              data-testid="groups-test-chat"
              title={t('settings.groups.testChatHint')}
              onClick={() => void onTestChat()}
            >
              {testingChat ? t('settings.groups.testing') : t('settings.groups.testChat')}
            </Button>
          </span>
          {chatReply != null && (
            <p className={s.fetchHint} data-testid="groups-chat-reply">
              {t('settings.groups.testChatReply', { reply: chatReply || '…' })}
            </p>
          )}
          {chatError && (
            <p className={s.fetchHint} data-failed>
              {t('settings.groups.testChatFailed', { error: chatError })}
            </p>
          )}
        </div>

        {/* 底部操作 */}
        <div className={s.planActions}>
          <Button variant="primary" size="sm" onClick={onSaveGroup} disabled={!form.id.trim()}>
            <Icon icon={Plus} size={12} /> {t('settings.groups.saveGroup')}
          </Button>
          {group && (
            <Button variant="ghost" size="sm" onClick={() => setForm(fromGroup(group))}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 本地折叠区 —— 切片内实现,不跨切片引 messages/Collapsible。 */
function Fold({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.gFold}>
      <button
        type="button"
        className={s.gFoldHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={ChevronDown} size={13} className={s.gFoldChevron} />
        <span>{label}</span>
      </button>
      {open && <div className={s.gFoldBody}>{children}</div>}
    </div>
  );
}
