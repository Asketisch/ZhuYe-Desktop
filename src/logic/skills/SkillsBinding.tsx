/**
 * Skills —— 技能与工具列表、Skill 市场安装的绑定。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { reflect_list_tools, reflect_list_skills, reflect_install_skill } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import type { SkillsViewProps, ToolGroupView } from '@/contracts/skills';

export function SkillsBinding({ view: View }: { view: ComponentType<SkillsViewProps> }) {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [repo, setRepo] = useState('');
  const [installing, setInstalling] = useState(false);
  const skillsQ = useQuery({ queryKey: ['skills'], queryFn: reflect_list_skills, staleTime: 30_000 });
  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: reflect_list_tools, staleTime: 30_000 });

  const runInstall = async () => {
    const trimmed = repo.trim();
    if (!trimmed || installing) return;
    setInstalling(true);
    try {
      await reflect_install_skill(trimmed);
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

  const skills = (skillsQ.data ?? []).map((skill) => ({
    ...skill,
    triggers: skill.triggers ?? [],
    tools: skill.tools ?? [],
    whenPaths: skill.whenPaths ?? [],
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
  />;
}
