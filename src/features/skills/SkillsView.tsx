/**
 * Skills & Tools —— 已安装 skills（`reflect_list_skills`）+ 已注册工具
 * （`reflect_list_tools`，按 `mcp__` 前缀分内置 / MCP 两组）。
 *
 * v1.x P3：此前只列工具 —— 真正的 skills（`~/.zhuye/skills` 与
 * `<cwd>/.zhuye/skills` 下的 SKILL.md 目录）从未展示；现在置顶显示
 * skills 组（含触发词与允许的工具），空组提示安装路径。
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Wrench, Wrench as ToolIcon, Sparkles, Store } from 'lucide-react';
import { reflect_list_tools, reflect_list_skills, reflect_install_skill } from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, EmptyState, Spinner, Button, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import s from './SkillsView.module.css';

export function SkillsView() {
  const { t } = useI18n();
  const skillsQ = useQuery({ queryKey: ['skills'], queryFn: reflect_list_skills, staleTime: 30_000 });
  const toolsQ = useQuery({ queryKey: ['tools'], queryFn: reflect_list_tools, staleTime: 30_000 });

  // fixture/旧后端可能缺 triggers/tools 字段 —— 统一兜底为数组。
  const skills = (skillsQ.data ?? []).map((s) => ({ ...s, triggers: s.triggers ?? [], tools: s.tools ?? [] }));
  const tools = toolsQ.data ?? [];
  const builtin = tools.filter((t) => !t.name.startsWith('mcp__'));
  const mcp = tools.filter((t) => t.name.startsWith('mcp__'));

  return (
    <PageShell
      icon={Wrench}
      title={t('skills.title')}
      subtitle={
        <>
          {t('skills.toolsCount', { count: tools.length })} <code className={s.codeInline}>mcp__</code>{t('skills.toolsCountSuffix')}
        </>
      }
      width="md"
    >
      {toolsQ.isLoading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : toolsQ.error ? (
        <Card level="flat" padding="none">
          <EmptyState icon={<Icon icon={Wrench} />} title={t('skills.error')} description={t('skills.errorDesc')} />
        </Card>
      ) : (
        <>
          {/* v1.11 桌面#1:Skill 市场 —— GitHub 仓库一键安装。 */}
          <SkillMarketplace />
          {/* v1.x P3：真 skills 列表（此前从未展示）。 */}
          <section className={s.group}>
            <div className={s.groupHeader}>
              <h3 className={s.groupTitle}>
                <Icon icon={Sparkles} size={14} /> {t('skills.installed')}
              </h3>
              <Badge variant="accent">{skills.length}</Badge>
            </div>
            {skillsQ.isLoading ? (
              <p className={s.empty}>{t('common.loading')}</p>
            ) : skills.length === 0 ? (
              <p className={s.empty}>{t('skills.installedEmpty')}</p>
            ) : (
              <div className={s.toolList}>
                {skills.map((skill) => (
                  <div key={skill.path} className={s.toolRow} data-testid={`skill-row-${skill.name}`}>
                    <div className={s.toolIcon}>
                      <Icon icon={Sparkles} size={14} />
                    </div>
                    <div className={s.toolBody}>
                      <code className={s.toolName}>{skill.name}</code>
                      {/* 内置技能来自 crate(无磁盘文件)—— 与用户/工作区技能区分。 */}
                      {skill.bundled && <Badge variant="neutral">{t('skills.bundled')}</Badge>}
                      <p className={s.toolDesc}>{skill.description}</p>
                      {(skill.triggers.length > 0 || skill.tools.length > 0) && (
                        <p className={s.skillMeta}>
                          {skill.triggers.length > 0 && (
                            <span>{t('skills.triggers')}: {skill.triggers.join(', ')}</span>
                          )}
                          {skill.tools.length > 0 && (
                            <span>{t('skills.allowedTools')}: {skill.tools.join(', ')}</span>
                          )}
                        </p>
                      )}
                      {skill.whenPaths && skill.whenPaths.length > 0 && (
                        <p className={s.skillMeta}>
                          <span>{t('skills.whenPaths')}: {skill.whenPaths.join(', ')}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <ToolGroup title={t('skills.builtin')} tools={builtin} />
          {mcp.length > 0 && <ToolGroup title={t('skills.mcp')} tools={mcp} variant="accent" />}
        </>
      )}
    </PageShell>
  );
}

/**
 * v1.11 桌面#1:Skill 市场 —— 输入 `owner/repo`(仓库根含 SKILL.md)
 * 一键安装到用户级 `~/.zhuye/skills/`;装完触发运行时重扫,列表即时
 * 刷新。安装失败(仓库无 SKILL.md / 网络错误)以 toast 显性化。
 */
function SkillMarketplace() {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [repo, setRepo] = useState('');
  const [installing, setInstalling] = useState(false);
  const skillsQ = useQuery({ queryKey: ['skills'], queryFn: reflect_list_skills, staleTime: 30_000 });

  const install = async () => {
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

  return (
    <section className={s.group}>
      <div className={s.groupHeader}>
        <h3 className={s.groupTitle}>
          <Icon icon={Store} size={14} /> {t('skills.market.title')}
        </h3>
      </div>
      <p className={s.empty}>{t('skills.market.desc')}</p>
      <div className={s.marketRow} data-testid="skill-market-row">
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={t('skills.market.placeholder')}
          aria-label={t('skills.market.title')}
          disabled={installing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void install();
          }}
        />
        <Button variant="primary" size="sm" disabled={!repo.trim() || installing} onClick={() => void install()} data-testid="skill-install-btn">
          {installing ? t('skills.market.installing') : t('skills.market.install')}
        </Button>
      </div>
    </section>
  );
}

function ToolGroup({
  title,
  tools,
  variant = 'neutral',
}: {
  title: string;
  tools: { name: string; description: string }[];
  variant?: 'neutral' | 'accent';
}) {
  const { t } = useI18n();
  return (
    <section className={s.group}>
      <div className={s.groupHeader}>
        <h3 className={s.groupTitle}>{title}</h3>
        <Badge variant={variant}>{tools.length}</Badge>
      </div>
      {tools.length === 0 ? (
        <p className={s.empty}>{t('skills.empty')}</p>
      ) : (
        <div className={s.toolList}>
          {tools.map((t) => (
            <div key={t.name} className={s.toolRow}>
              <div className={s.toolIcon}>
                <Icon icon={ToolIcon} size={14} />
              </div>
              <div className={s.toolBody}>
                <code className={s.toolName}>{t.name}</code>
                <p className={s.toolDesc}>{t.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
