import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { SettingsPermissionMode, SettingsSection, SettingsSlots, SettingsViewProps } from '@/contracts/settings';
import { zhuye_get_config, zhuye_save_config, zhuye_agent_status, zhuye_set_permission_mode } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readApprovalPolicy, writeApprovalPolicy, type UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
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
  const onPermission = (mode: SettingsPermissionMode) => permMutation.mutate(mode);

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
    onApprovalPolicyChange={(value) => { setApprovalPolicy(value); writeApprovalPolicy(sessionId, value); }}
    status={statusQuery.data}
    loading={configQuery.isLoading || statusQuery.isLoading}
    configLoading={configQuery.isLoading}
    saving={saveMutation.isPending} permissionPending={permMutation.isPending}
    saved={saved} error={error}
    onOpenPrompts={() => { openPromptPanel(); void promptList(); }}
    onPermission={onPermission} onSave={onSave} onClose={onClose} search={search} slots={slots}
  />;
}
