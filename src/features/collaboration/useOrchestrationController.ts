/**
 * 协作视图编排控制器 —— discussion / pipeline 的 GUI 触发面。
 *
 * - 历史讨论列表:`reflect_list_discussions`(只读);
 * - 运行讨论:TOML 配置(`reflect_pick_file` 原生文件选择)→
 *   `reflect_run_discussion`。运行期间的 Collab* 事件经事件通道进入
 *   agent store 的 `collabSessions`(视图侧直接订阅渲染实时进度);
 * - team pipeline:已注册 team + topic → `reflect_run_team_pipeline`,
 *   返回结构化 `PipelineReport`。
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import {
  reflect_list_discussions,
  reflect_run_discussion,
  type DiscussionRunOutcome,
  type DiscussionSessionInfo,
} from '@/utils/commands/discussion';
import {
  reflect_run_team_pipeline,
  type PipelineReport,
} from '@/utils/commands/pipeline';
import { reflect_list_teams } from '@/utils/commands/teams';
import { reflect_pick_file } from '@/utils/commands/workspaces';

export interface OrchestrationController {
  // —— 历史讨论 ——
  history: DiscussionSessionInfo[];
  historyLoading: boolean;
  refreshHistory: () => void;

  // —— 运行讨论 ——
  /** 当前选中的 discussion.toml 路径(null = 未选)。 */
  configPath: string | null;
  /** 打开原生 TOML 文件选择框(取消保持原值)。 */
  pickConfig: () => Promise<void>;
  /** 讨论运行 mutation(进行中 / 结果 / 错误)。 */
  runDiscussion: ReturnType<typeof useMutation<DiscussionRunOutcome, Error, void>>;
  /** agent store 中正在运行 / 刚结束的讨论实时状态(Collab* 事件驱动)。 */
  liveCollab: ReturnType<typeof useAgentStore.getState>['collabSessions'];

  // —— team pipeline ——
  teams: { name: string }[];
  pipelineTeam: string;
  setPipelineTeam: (name: string) => void;
  pipelineTopic: string;
  setPipelineTopic: (topic: string) => void;
  runPipeline: ReturnType<typeof useMutation<PipelineReport, Error, void>>;
}

export function useOrchestrationController(): OrchestrationController {
  const queryClient = useQueryClient();
  const liveCollab = useAgentStore((st) => st.collabSessions);

  const [configPath, setConfigPath] = useState<string | null>(null);
  const [pipelineTeam, setPipelineTeam] = useState('');
  const [pipelineTopic, setPipelineTopic] = useState('');

  const historyQ = useQuery({
    queryKey: ['discussions', 'list'],
    queryFn: () => reflect_list_discussions(),
    staleTime: 30_000,
  });

  const teamsQ = useQuery({
    queryKey: ['teams', 'list'],
    queryFn: () => reflect_list_teams(),
    staleTime: 30_000,
  });

  const runDiscussion = useMutation({
    mutationFn: async () => {
      if (!configPath) throw new Error('pick a discussion.toml first');
      return reflect_run_discussion(configPath);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discussions'] });
    },
  });

  const runPipeline = useMutation({
    mutationFn: async () => {
      if (!pipelineTeam) throw new Error('select a team first');
      if (!pipelineTopic.trim()) throw new Error('topic must be non-empty');
      return reflect_run_team_pipeline(pipelineTeam, pipelineTopic.trim());
    },
  });

  const pickConfig = async () => {
    const picked = await reflect_pick_file(['toml']);
    if (picked) setConfigPath(picked);
  };

  return {
    history: historyQ.data ?? [],
    historyLoading: historyQ.isLoading,
    refreshHistory: () => {
      void queryClient.invalidateQueries({ queryKey: ['discussions'] });
    },
    configPath,
    pickConfig,
    runDiscussion,
    liveCollab,
    teams: teamsQ.data ?? [],
    pipelineTeam,
    setPipelineTeam,
    pipelineTopic,
    setPipelineTopic,
    runPipeline,
  };
}
