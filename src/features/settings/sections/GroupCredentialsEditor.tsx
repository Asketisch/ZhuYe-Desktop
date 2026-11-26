/**
 * 组内凭据编辑器（`[[model_group.credentials]]` 条目）。
 *
 * 原「编码套餐（coding plan）」层的多凭据 / 配额能力下沉到这里：
 * 一个模型组 = 一个端点 + 一组凭据，组内凭据按 weight 加权派位，
 * quota 是**挂在凭据上**的订阅配额声明。
 *
 * 纯受控组件 —— 凭据列表由父组件（GroupDetail 的表单状态）持有，
 * 增删改只回调 `onChange`，落盘由父组件统一 upsert。
 * 标题由父级折叠区（Fold）承载，这里只渲染工具行（计数 / 新增 / 显隐）。
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Icon, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { type GroupCredentialEntry } from '@/logic/settings/config/groups';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupCredentialsEditorProps {
  credentials: GroupCredentialEntry[];
  onChange: (next: GroupCredentialEntry[]) => void;
}

/** 空凭据（label 必填 —— 引擎侧 CredentialConfig.label 必填，缺失会反序列化失败）。 */
function emptyCredential(): GroupCredentialEntry {
  return { label: '', apiKey: '', baseUrl: '', model: '', weight: 1, quota: null };
}

export function GroupCredentialsEditor({ credentials, onChange }: GroupCredentialsEditorProps) {
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);

  const patchAt = (index: number, patch: Partial<GroupCredentialEntry>) => {
    onChange(credentials.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const removeAt = (index: number) => {
    onChange(credentials.filter((_, i) => i !== index));
  };

  const addCredential = () => {
    onChange([...credentials, emptyCredential()]);
  };

  /** 配额输入：两侧都空 = 不声明配额；只填一侧 = 另一侧记 0（写盘时整条丢弃）。 */
  const patchQuota = (index: number, side: 'windowSecs' | 'maxTokens', raw: string) => {
    const current = credentials[index];
    const quota = current.quota ?? { windowSecs: 0, maxTokens: 0 };
    const next = { ...quota, [side]: raw.trim() === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0)) };
    const bothEmpty = next.windowSecs === 0 && next.maxTokens === 0;
    patchAt(index, { quota: bothEmpty ? null : next });
  };

  return (
    <div className={s.providerFields} data-testid="group-credentials">
      <div className={s.gToolbar}>
        <Badge variant="neutral">
          {t('settings.groups.credentialCount', { count: credentials.length })}
        </Badge>
        <span className={s.gToolbarSpacer} />
        <Button variant="ghost" size="sm" onClick={addCredential} data-testid="group-credential-add">
          <Icon icon={Plus} size={12} /> {t('settings.groups.credentialAdd')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
          {showKey ? t('settings.config.hide') : t('settings.config.show')}
        </Button>
      </div>
      {credentials.length === 0 && (
        <p className={s.sectionDesc}>{t('settings.groups.credentialsEmpty')}</p>
      )}
      {credentials.map((credential, index) => {
        const quota = credential.quota;
        const quotaIncomplete =
          quota != null && (quota.windowSecs <= 0 || quota.maxTokens <= 0);
        return (
          <div key={index} className={s.providerCard} data-testid={`group-credential-${index}`}>
            <div className={s.providerHeader}>
              <span className={s.providerName}>
                {credential.label.trim() || `#${index + 1}`}
              </span>
              {quota && <Badge variant="warning">{t('settings.groups.quotaBadge')}</Badge>}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAt(index)}
                data-testid={`group-credential-delete-${index}`}
              >
                <Icon icon={Trash2} size={12} /> {t('settings.groups.delete')}
              </Button>
            </div>
            <div className={s.providerFields}>
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialLabel')}</label>
                <Input
                  value={credential.label}
                  onChange={(e) => patchAt(index, { label: e.target.value })}
                  placeholder={t('settings.groups.credentialLabelPlaceholder')}
                  aria-label={t('settings.groups.credentialLabel')}
                  aria-invalid={credential.label.trim() ? undefined : true}
                />
              </div>
              {!credential.label.trim() && (
                <p className={s.fetchHint} data-failed>
                  {t('settings.groups.credentialLabelRequired')}
                </p>
              )}
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialApiKey')}</label>
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={credential.apiKey}
                  onChange={(e) => patchAt(index, { apiKey: e.target.value })}
                  placeholder="sk-…"
                  aria-label={t('settings.groups.credentialApiKey')}
                />
              </div>
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialBaseUrl')}</label>
                <Input
                  value={credential.baseUrl}
                  onChange={(e) => patchAt(index, { baseUrl: e.target.value })}
                  placeholder="https://open.bigmodel.cn/api/paas/v4"
                  aria-label={t('settings.groups.credentialBaseUrl')}
                />
              </div>
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialModel')}</label>
                <Input
                  value={credential.model}
                  onChange={(e) => patchAt(index, { model: e.target.value })}
                  placeholder="GLM-5.3-Flash"
                  aria-label={t('settings.groups.credentialModel')}
                />
              </div>
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialWeight')}</label>
                <Input
                  value={String(credential.weight)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    patchAt(index, { weight: raw === '' ? 1 : Math.max(0, Math.floor(Number(raw) || 0)) });
                  }}
                  inputMode="numeric"
                  aria-label={t('settings.groups.credentialWeight')}
                />
              </div>
              <div className={s.fieldRow}>
                <label className={s.fieldLabel}>{t('settings.groups.credentialQuota')}</label>
                <span className={s.modelFetchRow}>
                  <Input
                    value={quota ? String(quota.windowSecs) : ''}
                    onChange={(e) => patchQuota(index, 'windowSecs', e.target.value)}
                    placeholder="18000"
                    inputMode="numeric"
                    aria-label={t('settings.groups.quotaWindowSecs')}
                  />
                  <Input
                    value={quota ? String(quota.maxTokens) : ''}
                    onChange={(e) => patchQuota(index, 'maxTokens', e.target.value)}
                    placeholder="100000"
                    inputMode="numeric"
                    aria-label={t('settings.groups.quotaMaxTokens')}
                  />
                </span>
              </div>
              {quotaIncomplete && (
                <p className={s.fetchHint} data-failed>
                  {t('settings.groups.quotaIncomplete')}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
