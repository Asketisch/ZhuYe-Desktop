/**
 * Collaboration & Extensions —— MCP/LSP server 状态 + 多智能体编排
 * (discussion / pipeline)触发面(CSS Modules 版)。
 */
import { useQuery } from '@tanstack/react-query';
import { Network, Cpu, Users, Workflow } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_list_tools } from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Badge, Button, Card, EmptyState, Icon, Input, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useOrchestrationController } from './useOrchestrationController';
import { McpManager } from './McpManager';
import { PluginsPanel } from './PluginsPanel';
import { PipelineEditor } from './PipelineEditor';
import s from './CollaborationView.module.css';

function fmtStarted(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function CollaborationView() {
  const { t } = useI18n();
  const lspServers = useAgentStore((st) => st.lspServers);  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: reflect_list_tools, staleTime: 30_000 });
  const orch = useOrchestrationController();

  const mcpToolCount = (toolsQ.data ?? []).filter((t) => t.name.startsWith('mcp__')).length;
  const pipelineReport = orch.runPipeline.data;

  return (
    <PageShell
      icon={Network}
      title={t('collaboration.title')}
      subtitle={t('collaboration.subtitle')}
      width="md"
    >
      <section className={s.section}>
        {/* MCP 服务管理:此前只能观测,加服务得手改 config.toml。 */}
        <McpManager />
        {mcpToolCount > 0 && (
          <p className={s.hint}>{mcpToolCount} MCP tools registered (prefix <code className={s.codeInline}>mcp__</code>).</p>
        )}
      </section>

      <section className={s.section}>
        {/* 插件管理:此前只能看到插件带来的 slash 命令,装了什么/启停/卸载
            全部不可见。 */}
        <PluginsPanel />
      </section>

      <section className={s.section}>
        <div className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>
            <Icon icon={Cpu} size={14} />
            {t('collaboration.lspTitle')}
          </h3>
          {lspServers.length > 0 && <Badge variant="neutral">{lspServers.length}</Badge>}
        </div>
        {lspServers.length === 0 ? (
          <Card level="flat" padding="none">
            <EmptyState size="sm" icon={<Icon icon={Cpu} />} title={t('collaboration.lspEmpty')} />
          </Card>
        ) : (
          <div className={s.serverList}>
            {lspServers.map((l) => (
              <Card key={l.name} level="outlined" padding="sm" className={s.serverRow} data-status={l.status}>
                <span className={s.statusDot} data-status={l.status} />
                <div className={s.serverBody}>
                  <div className={s.serverName}>{l.name}</div>
                  {l.detail && <div className={s.serverDetail}>{l.detail}</div>}
                </div>
                <Badge variant={l.status === 'started' ? 'success' : 'danger'}>{l.status}</Badge>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className={s.section} data-testid="discussion-section">
        <div className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>
            <Icon icon={Users} size={14} />
            {t('collaboration.discussionTitle')}
          </h3>
          <Button size="sm" variant="ghost" onClick={orch.refreshHistory}>{t('traces.refresh')}</Button>
        </div>
        <Card level="outlined" padding="sm">
          <div className={s.orchForm}>
            <span className={s.orchPath} data-testid="discussion-config-path">
              {orch.configPath ?? t('collaboration.discussionNoConfig')}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void orch.pickConfig()}>
              {t('collaboration.discussionPickConfig')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!orch.configPath || orch.runDiscussion.isPending}
              data-testid="discussion-run"
              onClick={() => orch.runDiscussion.mutate()}
            >
              {orch.runDiscussion.isPending ? t('collaboration.discussionRunning') : t('collaboration.discussionRun')}
            </Button>
            {orch.runDiscussion.isPending && (
              <Button
                size="sm"
                variant="danger"
                disabled={orch.cancelDiscussion.isPending}
                data-testid="discussion-cancel"
                onClick={() => void orch.cancelDiscussion.mutate()}
              >
                {t('collaboration.discussionCancel')}
              </Button>
            )}
          </div>
          {orch.runDiscussion.isError && (
            <p className={s.errorText}>{String(orch.runDiscussion.error.message || orch.runDiscussion.error)}</p>
          )}
          {orch.runDiscussion.isSuccess && (
            orch.runDiscussion.data.llmBacked ? (
              <div className={s.reportBlock} data-testid="discussion-transcript">
                {orch.runDiscussion.data.transcript}
              </div>
            ) : (
              <p className={s.errorText} role="status">{t('collaboration.discussionNoModel')}</p>
            )
          )}
        </Card>

        {orch.liveCollab.length > 0 && (
          <Card level="outlined" padding="sm" className={s.liveSession} data-testid="discussion-live">
            {orch.liveCollab.map((sess) => (
              <div key={sess.id}>
                <div className={s.liveHeader}>
                  <span className={s.liveFrom}>{sess.id.slice(0, 8)}</span>
                  <Badge variant={sess.status === 'running' ? 'warning' : sess.status === 'failed' ? 'danger' : sess.status === 'cancelled' ? 'neutral' : 'success'}>{sess.status}</Badge>
                  <span>{sess.mode}</span>
                  <span>{sess.participants.join(', ')}</span>
                  {sess.rounds != null && <span>· {sess.rounds} rounds</span>}
                </div>
                <div className={s.liveMessages}>
                  {sess.messages.map((m, i) => (
                    <p key={i} className={s.liveMsg}>
                      <span className={s.liveFrom}>[{m.from}]</span>
                      {m.content}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        {orch.history.length > 0 && (
          <div className={s.historyList} data-testid="discussion-history">
            {orch.history.map((h) => (
              <Card key={h.sessionId} level="flat" padding="sm" className={s.historyRow}>
                <span className={s.historyTitle}>{h.title ?? h.sessionId.slice(0, 8)}</span>
                <span>{h.model}</span>
                <span>{h.messageCount} msgs</span>
                <span>{fmtStarted(h.startedAt)}</span>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className={s.section} data-testid="pipeline-section">
        <div className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>
            <Icon icon={Workflow} size={14} />
            {t('collaboration.pipelineTitle')}
          </h3>
        </div>
        <Card level="outlined" padding="sm">
          <div className={s.orchForm}>
            <Select
              size="sm"
              className={s.orchTopic}
              aria-label={t('collaboration.pipelineSelectTeam')}
              value={orch.pipelineTeam}
              onChange={(e) => orch.setPipelineTeam(e.target.value)}
              data-testid="pipeline-team"
            >
              <option value="">{t('collaboration.pipelineSelectTeam')}</option>
              {orch.teams.map((team) => (
                <option key={team.name} value={team.name}>{team.name}</option>
              ))}
            </Select>
            <Input
              size="sm"
              className={s.orchTopic}
              placeholder={t('collaboration.pipelineTopicPlaceholder')}
              value={orch.pipelineTopic}
              onChange={(e) => orch.setPipelineTopic(e.target.value)}
              data-testid="pipeline-topic"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!orch.pipelineTeam || !orch.pipelineTopic.trim() || orch.runPipeline.isPending}
              data-testid="pipeline-run"
              onClick={() => orch.runPipeline.mutate()}
            >
              {orch.runPipeline.isPending ? t('collaboration.pipelineRunning') : t('collaboration.pipelineRun')}
            </Button>
          </div>
          {orch.runPipeline.isError && (
            <p className={s.errorText}>{String(orch.runPipeline.error.message || orch.runPipeline.error)}</p>
          )}
          {pipelineReport && (
            <div className={s.reportBlock} data-testid="pipeline-report">
              {`status: ${pipelineReport.status} (${pipelineReport.total_elapsed_ms}ms)\n`}
              {pipelineReport.nodes
                .map((n) => `${n.status === 'Success' ? '✓' : n.status === 'Failed' ? '✗' : '–'} ${n.name} (${n.elapsed_ms}ms)${n.error ? ` — ${n.error}` : ''}`)
                .join('\n')}
            </div>
          )}
          {/* Pipeline TOML 编辑器 —— 此前只能跑手写文件,不能改。 */}
          <PipelineEditor />
        </Card>
      </section>
    </PageShell>
  );
}
