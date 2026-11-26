/**
 * ModelPicker —— 输入框右下角的模型选择器（紧凑触发器）。
 *
 * 渲染在输入卡片**内部**的底栏右侧，与语音、发送按钮同一行。
 *
 * 选中态单一事实源：配置里的 `[active].group`（当前接入的**模型组 id**）
 * + `[active].credential`（组内被钉住的那条凭据 label）。切换一律走
 * `zhuye_set_model(group, model, label)` —— 后端改配置 + 热重载模型栈，
 * 协议不动。
 *
 * 选项来源只有「模型组」一层（「内置编码套餐」整层删除；从供应商接口
 * 拉取模型清单的能力只留在 设置 → 模型组，不进输入框）：
 *  - 组本身 → `展示名 · 组模型`；
 *  - 组内凭据 → `展示名 · 凭据label`（凭据 label 参与钉住语义）。
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { zhuye_agent_status, zhuye_get_config, zhuye_set_model } from '@/utils/commands/harness/config';
import { syncEffortPreference } from '@/stores/agent/policy/effortPreference';
import { useQueryClient } from '@tanstack/react-query';
import {
  groupDisplayLabel,
  listGroups,
  readActiveCredential,
  readActiveGroup,
  type GroupEntry,
} from '@/logic/knowledge/models/modelGroups';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import s from '@/render/input/composer/ModelPicker.module.css';

/** option value 前缀 —— 两类目标的稳定键。 */
const GROUP_VALUE = 'group:';
const CREDENTIAL_VALUE = 'cred:';

export function ModelPicker() {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);

  // 模型组：配置里唯一的可切换目标集合。
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [activeCredential, setActiveCredential] = useState('');
  const [currentSpec, setCurrentSpec] = useState('');
  const [switching, setSwitching] = useState(false);

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

  /** 切换失败 —— 后端拒绝必须可见（静默吞错会让「点了没反应」无法诊断）。 */
  const qc = useQueryClient();
  // 模型切换 = 强制重绑,思考强度槽位会被配置默认重置 —— 恢复用户偏好
  // 并失效 capability 缓存,让 pill 立即按新槽位(恢复后的档)回显。
  const restoreEffortAfterSwitch = async () => {
    await syncEffortPreference(useAgentStore.getState().loadedSessionId);
    void qc.invalidateQueries({ queryKey: ['effort-capability'] });
  };

  const reportSwitchFailure = (e: unknown) => {
    pushToast({
      kind: 'error',
      message: t('composer.controls.switchFailed', { msg: e instanceof Error ? e.message : String(e) }),
    });
  };

  const onSwitchModel = async (value: string) => {
    if (switching) return;

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
        // 同步 store 的 session.model:effort capability 等按模型分键的
        // 查询靠它换 key 重拉(引擎只在下次 turn 才发 session_configured,
        // 热重载当下无事件,这里乐观写入保证即时刷新)。
        if (spec) {
          const prev = useAgentStore.getState().session;
          useAgentStore.setState({ session: { model: spec, provider: prev?.provider ?? '' } });
        }
        await restoreEffortAfterSwitch();
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
        // 同步 store 的 session.model(effort capability 按模型分键,同上)。
        if (spec) {
          const prev = useAgentStore.getState().session;
          useAgentStore.setState({ session: { model: spec, provider: prev?.provider ?? '' } });
        }
        await restoreEffortAfterSwitch();
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
        </select>
        <ChevronDown size={12} className={s.caret} aria-hidden="true" />
      </span>
    </span>
  );
}
