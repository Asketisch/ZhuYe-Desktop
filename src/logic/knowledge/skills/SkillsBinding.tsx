/**
 * Skills —— 已安装技能、工具列表、Skill 市场(skills.sh 搜索 + 一键安装)。
 *
 * 市场搜索 300ms debounce + useQuery(索引 24h TTL 由后端缓存),
 * 安装走 useMutation → 成功 toast + refetch 技能列表(复刻 PluginsPanel
 * 市场行的数据流)。已装判定按技能名匹配。
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import {
  zhuye_list_tools,
  zhuye_list_skills,
  zhuye_install_skill,
  zhuye_search_skill_market,
  zhuye_install_skill_from_market,
  zhuye_refresh_skill_market_index,
} from '@/utils/commands';
import type { SkillMarketEntry } from '@/utils/commands/skills';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import type { SkillsViewProps, ToolGroupView } from '@/contracts/knowledge/skills';

/** 输入停止 300ms 后才发起搜索,避免每敲一个字打一次本地索引。 */
const SEARCH_DEBOUNCE_MS = 300;

export function SkillsBinding({ view: View }: { view: ComponentType<SkillsViewProps> }) {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const queryClient = useQueryClient();
  const [repo, setRepo] = useState('');
  const [installing, setInstalling] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const skillsQ = useQuery({ queryKey: ['skills'], queryFn: zhuye_list_skills, staleTime: 30_000 });
  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: zhuye_list_tools, staleTime: 30_000 });

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(marketQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [marketQuery]);

  const marketQ = useQuery({
    queryKey: ['skill-market', debouncedQuery],
    queryFn: () => zhuye_search_skill_market(debouncedQuery, 50),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60_000,
  });

  const installMutation = useMutation({
    mutationFn: (source: string) => zhuye_install_skill_from_market(source),
    onSuccess: async (_id, source) => {
      pushToast({ kind: 'success', message: t('skills.market.installed', { repo: source }) });
      setMarketQuery('');
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onError: (e) => {
      pushToast({
        kind: 'error',
        message: t('skills.market.installFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => zhuye_refresh_skill_market_index(),
    onSuccess: (count) => {
      pushToast({ kind: 'success', message: t('skills.market.indexRefreshed', { count }) });
      void queryClient.invalidateQueries({ queryKey: ['skill-market'] });
    },
    onError: (e) => {
      pushToast({
        kind: 'error',
        message: t('skills.market.indexFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    },
  });

  const runInstall = async () => {
    const trimmed = repo.trim();
    if (!trimmed || installing) return;
    setInstalling(true);
    try {
      await zhuye_install_skill(trimmed);
      pushToast({ kind: 'success', message: t('skills.market.installed', { repo: trimmed }) });
      setRepo('');
      await skillsQ.refetch();
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('skills.market.installFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setInstalling(false);
    }
  };

  const installedNames = useMemo(
    () => new Set((skillsQ.data ?? []).map((s) => s.name.toLowerCase())),
    [skillsQ.data],
  );
  const skills = (skillsQ.data ?? []).map((skill) => ({
    ...skill,
    triggers: skill.triggers ?? [],
    tools: skill.tools ?? [],
    whenPaths: skill.whenPaths ?? [],
    sourceLabel: (() => {
      const p = skill.path ?? '';
      return p.includes('/.agents/skills/')
        ? 'agents' as const
        : p.includes('/.zhuye/skills/')
          ? 'zhuye' as const
          : null;
    })(),
  }));
  const tools = toolsQ.data ?? [];
  const builtin = tools.filter((tool) => !tool.name.startsWith('mcp__'));
  const mcp = tools.filter((tool) => tool.name.startsWith('mcp__'));

  const toolGroups: ToolGroupView[] = [
    { title: t('skills.builtin'), variant: 'neutral' as const, tools: builtin.map((tool) => ({ name: tool.name, description: tool.description })) },
  ];
  if (mcp.length > 0) {
    toolGroups.push({ title: t('skills.mcp'), variant: 'accent' as const, tools: mcp.map((tool) => ({ name: tool.name, description: tool.description })) });
  }

  return <View
    t={t}
    loading={toolsQ.isLoading}
    error={Boolean(toolsQ.error)}
    skills={skills}
    toolGroups={toolGroups}
    toolCount={tools.length}
    repo={repo}
    installing={installing}
    onRepoChange={setRepo}
    onInstall={() => { void runInstall(); }}
    marketQuery={marketQuery}
    marketResults={debouncedQuery.length >= 2 ? (marketQ.data ?? []) : []}
    marketSearching={debouncedQuery.length >= 2 && marketQ.isFetching}
    marketInstallingId={installMutation.isPending ? (installMutation.variables ?? '') : ''}
    installedNames={installedNames}
    onMarketQueryChange={setMarketQuery}
    onMarketInstall={(entry: SkillMarketEntry) => installMutation.mutate(entry.id)}
    refreshingIndex={refreshMutation.isPending}
    onRefreshIndex={() => refreshMutation.mutate()}
  />;
}
