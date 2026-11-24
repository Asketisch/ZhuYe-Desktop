import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { SettingsPermissionMode, SettingsSection, SettingsSlots, SettingsViewProps } from '@/contracts/settings';
import { zhuye_get_config, zhuye_save_config, zhuye_agent_status, zhuye_set_permission_mode } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readApprovalPolicy, writeApprovalPolicy, type UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import { writePermissionPreference } from '@/stores/agent/permissionPreference';
import { syncEffortPreference } from '@/stores/agent/effortPreference';
import { confirmDialog } from '@/logic/modals/confirm';
import { useSettingsSearch } from './useSettingsSearch';

/** 设置草稿、保存并发和权限动作的绑定。 */
export function SettingsBinding({ view: View, slots, onClose }: { view: ComponentType<SettingsViewProps>; slots: SettingsSlots; onClose?: () => void }) {
  const qc = useQueryClient();
  const [section, setSection] = useState<SettingsSection>('groups');
  const [rawToml, setRawToml] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const { t, locale, setLocale } = useI18n();
  const sessionId = useAgentStore((state) => state.loadedSessionId);
  // 会话工作模式（三态归一）—— 行为分区分段的选中态真源。
  const permissionMode = useAgentStore((state) => state.permissionMode);
  const openPromptPanel = useAgentStore((state) => state.openPromptPanel);
  const promptList = useAgentStore((state) => state.promptList);
  const [approvalPolicy, setApprovalPolicy] = useState<UserApprovalPolicy>(() => readApprovalPolicy(sessionId));
  useEffect(() => setApprovalPolicy(readApprovalPolicy(sessionId)), [sessionId]);

  // 未保存编辑保护：configQuery staleTime=0 + 窗口聚焦 refetch，会让
  // useEffect 无条件 setRawToml(data) 把用户正在编辑的内容冲掉。
  // 记录最近一次 seed 值与脏标记：只在缓冲未被修改（或刚保存成功）时接受刷新。
  const seededRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const rawTomlRef = useRef(rawToml);
  rawTomlRef.current = rawToml;
  const updateRawToml = useCallback((next: string) => {
    rawTomlRef.current = next;
    setRawToml(next);
    dirtyRef.current = next !== seededRef.current;
  }, []);

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: zhuye_get_config,
    staleTime: 0,
  });
  const statusQuery = useQuery({
    queryKey: ['agent-status'],
    queryFn: zhuye_agent_status,
    staleTime: 30_000,
  });

  useEffect(() => {
    const data = configQuery.data;
    if (!data) return;
    if (dirtyRef.current && rawToml !== seededRef.current) return;
    seededRef.current = data;
    dirtyRef.current = false;
    setRawToml(data);
    // rawToml 只参与脏检查读，不作为触发源（否则每次编辑都会重跑本 effect）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (toml: string) => zhuye_save_config(toml),
    onSuccess: (_result, savedToml) => {
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
      // 以实际提交的快照为基准，保留保存期间产生的新编辑。
      seededRef.current = savedToml;
      dirtyRef.current = rawTomlRef.current !== savedToml;
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['agent-status'] });
      // 配置保存可能触发热重载 + 强制重绑（模型组段变更）—— 重绑会用
      // 配置默认重置思考强度槽位，恢复用户在 composer 显式选过的档。
      void syncEffortPreference(sessionId);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const permMutation = useMutation({
    mutationFn: async (mode: string) => zhuye_set_permission_mode(mode),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const onSave = () => saveMutation.mutate(rawToml);
  const onPermission = (mode: SettingsPermissionMode) => {
    // 只记录 UI 三态；弃用 wire 档（accept_edits/deny/bubble/bypass）
    // 不在设置页暴露，也不写偏好。会话 id 未定时落 'new' 键。
    if (mode === 'plan' || mode === 'prompt' || mode === 'auto') {
      writePermissionPreference(sessionId, mode);
    }
    permMutation.mutate(mode);
  };
  // 完全访问开关：与 composer 权限菜单同一确认门 —— 启用先弹「不再确认」
  // 后果，取消不落偏好；关闭直接生效。
  const onFullAccessChange = async (on: boolean) => {
    if (on && approvalPolicy !== 'full_access') {
      const ok = await confirmDialog({
        title: t('composer.perm.fullAccessTitle'),
        message: t('composer.perm.fullAccessMessage'),
        confirmLabel: t('composer.controls.perm.full'),
      });
      if (!ok) return;
    }
    setApprovalPolicy(on ? 'full_access' : 'auto');
    writeApprovalPolicy(sessionId, on ? 'full_access' : 'auto');
  };

  // 分区搜索（⌘K）：状态与键盘监听在 logic 层，渲染层只消费。
  const search = useSettingsSearch(setSection);

  const toggleSecret = (key: string) => setShowSecrets((p) => ({ ...p, [key]: !p[key] }));

  return <View
    t={t} locale={locale} onLocaleChange={setLocale}
    section={section} onSectionChange={setSection}
    rawToml={rawToml} onTomlChange={updateRawToml}
    onCommit={(next) => { updateRawToml(next); saveMutation.mutate(next); }}
    showSecrets={showSecrets} onToggleSecret={toggleSecret}
    approvalPolicy={approvalPolicy}
    onFullAccessChange={(on) => void onFullAccessChange(on)}
    approvalPending={permMutation.isPending}
    status={statusQuery.data}
    loading={configQuery.isLoading || statusQuery.isLoading}
    configLoading={configQuery.isLoading}
    saving={saveMutation.isPending} permissionPending={permMutation.isPending}
    permissionMode={permissionMode}
    saved={saved} error={error}
    onOpenPrompts={() => { openPromptPanel(); void promptList(); }}
    onPermission={onPermission} onSave={onSave} onClose={onClose} search={search} slots={slots}
  />;
}
