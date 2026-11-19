/**
 * 模型组新增/编辑表单（`[[provider_group]]` 条目）。
 *
 * 与 PlanEditor（内置端口 plan）平级：组 = 命名端点（id / endpoint /
 * base_url / api_key），保存后**自动拉取**组内模型清单（前端 5 分钟
 * TTL memo，命中缓存零网络），点选模型即写为组默认模型并即时落盘；
 * 手动「刷新模型列表」走 force refresh。
 *
 * 共享同一份 rawToml buffer（props 传入），与设置页统一的 onCommit
 * 通道一致 —— 每个保存/点选都是完整意图，立即落盘。
 */
import { useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { Badge, Button, Icon, Input, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_test_provider_chat, type ProviderModelInfo } from '@/utils/commands';
import { fetchProviderModels } from '@/logic/settings/config/modelCatalog';
import {
  GROUP_ENDPOINTS,
  groupDisplayLabel,
  isValidGroupId,
  listGroups,
  removeGroup,
  upsertGroup,
  type GroupEndpoint,
  type GroupEntry,
} from '../config/groups';
import { ModelOptionsList } from '../components/ModelOptionsList';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupFormProps {
  rawToml: string;
  onChange: (next: string) => void;
  /** 把变更立即落盘（reflect_save_config → 后端校验 + 热重载 provider 栈）。 */
  onCommit?: (next: string) => void;
}

interface FormState {
  id: string;
  label: string;
  endpoint: GroupEndpoint;
  apiKey: string;
  baseUrl: string;
  model: string;
  responsesApi: boolean;
  timeoutSecs: string;
  /** 正在编辑的原始 id（区分「编辑既有组」与「新增」）。 */
  editingId: string | null;
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
  editingId: null,
};

export function GroupForm({ rawToml, onChange, onCommit }: GroupFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showKey, setShowKey] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  // 自动拉取的模型清单（挂在端点 key 上；保存 / 打开表单后自动触发）。
  const [formModels, setFormModels] = useState<ProviderModelInfo[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // 连通性测试（发送「你好」，无 system / 无 tools）。
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [testingChat, setTestingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p }));

  const hasEndpoint = () => form.baseUrl.trim().length > 0;
  // openai 兼容端点可免 Key（空 key 不发 Authorization 头）；anthropic 协议没有免 Key 形态。
  const keylessAllowed = form.endpoint === 'openai';
  const hasCredentials = () => form.apiKey.trim().length > 0 || keylessAllowed;

  /** 拉取组端点的模型清单（force = 绕过 TTL 缓存）。显式传端点三元组：
   * 「编辑既有组」的自动拉取发生在 setForm 生效之前,不能读闭包里的
   * 旧 form。 */
  const fetchFor = async (baseUrl: string, apiKey: string, endpoint: GroupEndpoint, force = false) => {
    if (!baseUrl.trim() || (apiKey.trim() === '' && endpoint !== 'openai') || fetchingModels) return;
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

  const onFetchModels = (force = false) => fetchFor(form.baseUrl, form.apiKey, form.endpoint, force);

  /** 保存组 → 即时落盘 → 自动拉取模型清单。 */
  const onSaveGroup = () => {
    const id = form.id.trim();
    if (!isValidGroupId(id)) {
      setIdError(t('settings.groups.invalidId'));
      return;
    }
    // id 唯一性:与「其他」组冲突时拒绝(编辑自身除外)。
    const others = listGroups(rawToml).filter((g) => g.id !== form.editingId);
    if (others.some((g) => g.id === id)) {
      setIdError(t('settings.groups.duplicateId', { id }));
      return;
    }
    setIdError(null);
    let next = rawToml;
    // 编辑中改名:upsert 按「新 id」定位,找不到旧块会追加新条目导致
    // 重复 —— 先摘除旧位置的块。
    if (form.editingId && form.editingId !== id) {
      next = removeGroup(next, form.editingId);
    }
    next = upsertGroup(next, {
      id,
      label: form.label.trim(),
      endpoint: form.endpoint,
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      responsesApi: form.responsesApi,
      timeoutSecs: form.timeoutSecs.trim(),
    });
    onChange(next);
    onCommit?.(next);
    patch({ editingId: id, id });
    // 保存后自动拉取:端点配齐才拉,否则留给下次(输入 base_url/key 后)。
    void fetchFor(form.baseUrl, form.apiKey, form.endpoint);
  };

  /** 点选模型 → 写为组默认模型并即时落盘。组尚未保存时只填表单字段
   * （避免把半截表单提前 upsert 成一条残缺的组条目）。 */
  const onPickModel = (modelId: string) => {
    if (!form.editingId) {
      patch({ model: modelId });
      return;
    }
    patch({ model: modelId });
    const next = upsertGroup(rawToml, {
      id: form.id.trim(),
      label: form.label.trim(),
      endpoint: form.endpoint,
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
      model: modelId,
      responsesApi: form.responsesApi,
      timeoutSecs: form.timeoutSecs.trim(),
    });
    onChange(next);
    onCommit?.(next);
  };

  const onEdit = (group: GroupEntry) => {
    setForm({
      id: group.id,
      label: group.label,
      endpoint: group.endpoint,
      apiKey: group.apiKey,
      baseUrl: group.baseUrl,
      model: group.model,
      responsesApi: group.responsesApi,
      timeoutSecs: group.timeoutSecs,
      editingId: group.id,
    });
    setIdError(null);
    setFormModels(null);
    setModelsError(null);
    setChatReply(null);
    setChatError(null);
    // 打开编辑表单即自动拉取(命中 TTL 缓存则零网络)。
    void fetchFor(group.baseUrl, group.apiKey, group.endpoint);
  };

  const onDelete = (group: GroupEntry) => {
    const next = removeGroup(rawToml, group.id);
    onChange(next);
    onCommit?.(next);
    if (form.editingId === group.id) setForm(EMPTY_FORM);
  };

  const onTestChat = async () => {
    if (!hasCredentials() || !hasEndpoint() || !form.model.trim() || testingChat) return;
    setTestingChat(true);
    setChatReply(null);
    setChatError(null);
    try {
      const res = await reflect_test_provider_chat(
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

  const groups = listGroups(rawToml);

  return (
    <section data-testid="groups-editor">
      {/* 组列表 */}
      <h4 className={s.sectionTitle}>{t('settings.groups.list')}</h4>
      {groups.length === 0 && <p className={s.sectionDesc}>{t('settings.groups.empty')}</p>}
      <div className={s.providerFields}>
        {groups.map((group) => (
          <div key={group.id} className={s.providerCard}>
            <div className={s.providerHeader}>
              <span className={s.providerName}>{groupDisplayLabel(group)}</span>
              <Badge variant="info">{group.endpoint}</Badge>
              {group.responsesApi && <Badge variant="neutral">responses</Badge>}
            </div>
            <div className={s.planMeta}>
              {group.apiKey ? (
                <code>{maskKey(group.apiKey)}</code>
              ) : (
                <Badge variant="neutral">{t('settings.plans.keylessBadge')}</Badge>
              )}
              {group.model && <span>{group.model}</span>}
              {group.baseUrl && <span className={s.planUrl}>{group.baseUrl}</span>}
            </div>
            <div className={s.planActions}>
              <Button variant="ghost" size="sm" onClick={() => onEdit(group)} data-testid={`group-edit-${group.id}`}>
                <Icon icon={RefreshCw} size={12} /> {t('settings.plans.edit')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(group)} data-testid={`group-delete-${group.id}`}>
                {t('settings.plans.delete')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 新增 / 编辑表单 */}
      <h4 className={s.sectionTitle}>
        {form.editingId ? t('settings.groups.editTitle') : t('settings.groups.addTitle')}
      </h4>
      <div className={s.providerFields}>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.id')}</label>
          <Input
            value={form.id}
            onChange={(e) => patch({ id: e.target.value.replace(/\s/g, '') })}
            placeholder="bigmodel"
            aria-invalid={idError ? true : undefined}
          />
        </div>
        {idError && (
          <p className={s.fetchHint} data-failed>
            {idError}
          </p>
        )}
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.label')}</label>
          <Input
            value={form.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder={t('settings.groups.labelPlaceholder')}
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.provider')}</label>
          <Select
            value={form.endpoint}
            aria-label={t('settings.plans.provider')}
            onChange={(e) => {
              patch({ endpoint: e.target.value as GroupEndpoint });
              setFormModels(null);
              setModelsError(null);
            }}
          >
            {GROUP_ENDPOINTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
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
            placeholder="https://open.bigmodel.cn/api/paas/v4"
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.model')}</label>
          <span className={s.modelFetchRow}>
            <Input
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="GLM-5.3-Flash / claude-sonnet-4 …"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={fetchingModels || !hasCredentials() || !hasEndpoint()}
              data-testid="groups-fetch-models"
              title={modelsError ?? t('settings.groups.autoFetchHint')}
              onClick={() => void onFetchModels(true)}
            >
              <Icon icon={RefreshCw} size={12} />{' '}
              {fetchingModels ? t('settings.plans.fetchingModels') : t('settings.plans.fetchModels')}
            </Button>
          </span>
          {formModels && !modelsError && (
            <span className={s.fetchHint}>
              {t('settings.plans.modelsFetched', { count: String(formModels.length) })}
            </span>
          )}
          {modelsError && <span className={s.fetchHint} data-failed>{modelsError}</span>}
          {formModels && !modelsError && formModels.length > 0 && (
            <ModelOptionsList
              models={formModels}
              value={form.model}
              onPick={onPickModel}
              testId="groups-model-options"
            />
          )}
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.advanced')}</label>
          <span className={s.modelFetchRow}>
            <label className={s.fieldHint}>
              <input
                type="checkbox"
                checked={form.responsesApi}
                onChange={(e) => patch({ responsesApi: e.target.checked })}
                disabled={form.endpoint !== 'openai'}
                data-testid="groups-responses-api"
              />{' '}
              {t('settings.groups.responsesApi')}
            </label>
            <Input
              value={form.timeoutSecs}
              onChange={(e) => patch({ timeoutSecs: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="300"
              inputMode="numeric"
              aria-label={t('settings.groups.timeoutSecs')}
            />
          </span>
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.plans.testChat')}</label>
          <span className={s.modelFetchRow}>
            <Button
              variant="ghost"
              size="sm"
              disabled={testingChat || !hasCredentials() || !hasEndpoint() || !form.model.trim()}
              data-testid="groups-test-chat"
              title={t('settings.plans.testChatHint')}
              onClick={() => void onTestChat()}
            >
              {testingChat ? t('settings.plans.testing') : t('settings.plans.testChat')}
            </Button>
          </span>
        </div>
        {chatReply != null && (
          <p className={s.fetchHint} data-testid="groups-chat-reply">
            {t('settings.plans.testChatReply', { reply: chatReply || '…' })}
          </p>
        )}
        {chatError && (
          <p className={s.fetchHint} data-failed>
            {t('settings.plans.testChatFailed', { error: chatError })}
          </p>
        )}
        <div className={s.planActions}>
          <Button variant="primary" size="sm" onClick={onSaveGroup} disabled={!form.id.trim()}>
            <Icon icon={Plus} size={12} /> {t('settings.groups.saveGroup')}
          </Button>
          {form.editingId && (
            <Button variant="ghost" size="sm" onClick={() => setForm(EMPTY_FORM)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** 密钥展示遮罩：保留末 4 位（与 plans.ts 的 maskKey 同口径 —— 此处
 * 直接内联,避免纯函数层引入展示细节）。 */
function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}
