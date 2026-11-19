/**
 * Skills —— 已安装技能、内置/MCP 工具与 Skill 市场（GitHub 安装）。
 */
import { Wrench, Wrench as ToolIcon, Sparkles, Store } from 'lucide-react';
import type { SkillsViewProps } from '@/contracts/skills';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';
import { Spinner } from '../design-system/Spinner';
import { Button } from '../design-system/Button';
import { Input } from '../design-system/Input';
import s from './SkillsView.module.css';

export function SkillsView({ t, loading, error, skills, toolGroups, toolCount, repo,
  installing, onRepoChange, onInstall }: SkillsViewProps) {
  return (
    <PageShell
      icon={Wrench}
      title={t('skills.title')}
      subtitle={<>{t('skills.toolsCount', { count: toolCount })} <code className={s.codeInline}>mcp__</code>{t('skills.toolsCountSuffix')}</>}
      width="md"
    >
      {loading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : error ? (
        <Card level="flat" padding="none">
          <EmptyState icon={<Icon icon={Wrench} />} title={t('skills.error')} description={t('skills.errorDesc')} />
        </Card>
      ) : (
        <>
          <section className={s.group}>
            <div className={s.groupHeader}>
              <h3 className={s.groupTitle}><Icon icon={Store} size={14} /> {t('skills.market.title')}</h3>
            </div>
            <p className={s.empty}>{t('skills.market.desc')}</p>
            <div className={s.marketRow} data-testid="skill-market-row">
              <Input value={repo} onChange={(event) => onRepoChange(event.target.value)}
                placeholder={t('skills.market.placeholder')} aria-label={t('skills.market.title')}
                disabled={installing}
                onKeyDown={(event) => { if (event.key === 'Enter') onInstall(); }} />
              <Button variant="primary" size="sm" disabled={!repo.trim() || installing}
                onClick={onInstall} data-testid="skill-install-btn">
                {installing ? t('skills.market.installing') : t('skills.market.install')}
              </Button>
            </div>
          </section>

          <section className={s.group}>
            <div className={s.groupHeader}>
              <h3 className={s.groupTitle}><Icon icon={Sparkles} size={14} /> {t('skills.installed')}</h3>
              <Badge variant="accent">{skills.length}</Badge>
            </div>
            {skills.length === 0 ? (
              <p className={s.empty}>{t('skills.installedEmpty')}</p>
            ) : (
              <div className={s.toolList}>
                {skills.map((skill) => (
                  <div key={skill.path} className={s.toolRow} data-testid={`skill-row-${skill.name}`}>
                    <div className={s.toolIcon}><Icon icon={Sparkles} size={14} /></div>
                    <div className={s.toolBody}>
                      <code className={s.toolName}>{skill.name}</code>
                      {skill.bundled && <Badge variant="neutral">{t('skills.bundled')}</Badge>}
                      <p className={s.toolDesc}>{skill.description}</p>
                      {(skill.triggers.length > 0 || skill.tools.length > 0) && (
                        <p className={s.skillMeta}>
                          {skill.triggers.length > 0 && <span>{t('skills.triggers')}: {skill.triggers.join(', ')}</span>}
                          {skill.tools.length > 0 && <span>{t('skills.allowedTools')}: {skill.tools.join(', ')}</span>}
                        </p>
                      )}
                      {skill.whenPaths.length > 0 && (
                        <p className={s.skillMeta}><span>{t('skills.whenPaths')}: {skill.whenPaths.join(', ')}</span></p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {toolGroups.map((group) => (
            <section key={group.title} className={s.group}>
              <div className={s.groupHeader}>
                <h3 className={s.groupTitle}>{group.title}</h3>
                <Badge variant={group.variant}>{group.tools.length}</Badge>
              </div>
              {group.tools.length === 0 ? (
                <p className={s.empty}>{t('skills.empty')}</p>
              ) : (
                <div className={s.toolList}>
                  {group.tools.map((tool) => (
                    <div key={tool.name} className={s.toolRow}>
                      <div className={s.toolIcon}><Icon icon={ToolIcon} size={14} /></div>
                      <div className={s.toolBody}>
                        <code className={s.toolName}>{tool.name}</code>
                        <p className={s.toolDesc}>{tool.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </PageShell>
  );
}
