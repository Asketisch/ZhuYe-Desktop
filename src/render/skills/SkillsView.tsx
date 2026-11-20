/**
 * Skills —— 已安装技能、内置/MCP 工具与 skills.sh Skill 市场（搜索 + 一键安装）。
 *
 * 视觉走设置页套件（SettingsPage.module.css）：分组头（resHead）+ 圆角
 * 行容器（resList/resItem + iconTile），徽标 / 按钮 / 空态统一套件形态。
 * 测试锚点（skill-market-* / skill-row-* / market-install-*）全部保留。
 */
import { Hammer, Search, Sparkles, Store, Wrench, RefreshCw, Check } from 'lucide-react';
import type { SkillsViewProps } from '@/contracts/skills';
import { PageShell } from '../shell/PageShell';
import { Spinner } from '../design-system/Spinner';
import kit from '../settings/SettingsPage.module.css';

const ToolIcon = Hammer;

export function SkillsView({ t, loading, error, skills, toolGroups, toolCount, repo,
  installing, onRepoChange, onInstall, marketQuery, marketResults, marketSearching,
  marketInstallingId, installedNames, onMarketQueryChange, onMarketInstall,
  refreshingIndex, onRefreshIndex }: SkillsViewProps) {
  return (
    <PageShell
      icon={Wrench}
      title={t('skills.title')}
      subtitle={<>{t('skills.toolsCount', { count: toolCount })} <code className={kit.mono}>mcp__</code>{t('skills.toolsCountSuffix')}</>}
      width="md"
    >
      {loading ? (
        <div className={kit.emptyBox}><Spinner size={20} /></div>
      ) : error ? (
        <div className={kit.notice}><span>{t('skills.error')}：{t('skills.errorDesc')}</span></div>
      ) : (
        <>
          <section className={kit.resGroup}>
            <div className={kit.resHead}>
              <h3><Store size={14} strokeWidth={1.5} aria-hidden /> {t('skills.market.title')}</h3>
              <div className={kit.actions}>
                <button type="button" className={kit.btn} onClick={onRefreshIndex}
                  disabled={refreshingIndex} title={t('skills.market.refresh')} aria-label={t('skills.market.refresh')}>
                  <RefreshCw strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            </div>
            <p className={kit.secDesc}>{t('skills.market.desc')}</p>
            <div className={kit.toolbar} data-testid="skill-market-search">
              <div className={`${kit.searchBox} ${kit.searchWide}`}>
                <Search strokeWidth={1.5} aria-hidden />
                <input value={marketQuery} onChange={(event) => onMarketQueryChange(event.target.value)}
                  placeholder={t('skills.market.searchPlaceholder')} aria-label={t('skills.market.searchPlaceholder')} />
              </div>
            </div>

            {marketSearching && <div className={kit.emptyBox}><Spinner size={16} /></div>}
            {!marketSearching && marketQuery.trim().length >= 2 && marketResults.length === 0 && (
              <p className={kit.secDesc}>{t('skills.market.noResults')}</p>
            )}
            {!marketSearching && marketResults.length > 0 && (
              <div className={kit.resList} data-testid="skill-market-results">
                {marketResults.map((entry) => {
                  const installed = installedNames.has(entry.slug.toLowerCase());
                  const installingThis = marketInstallingId === entry.id;
                  return (
                    <div key={entry.id} className={kit.resItem} data-testid={`market-result-${entry.id}`}>
                      <span className={kit.iconTile}><Sparkles strokeWidth={1.5} aria-hidden /></span>
                      <div className={kit.resMain}>
                        <div className={kit.titleRow}>
                          <code className={`${kit.resTitle} ${kit.mono}`}>{entry.slug}</code>
                          <span className={kit.badge}>{entry.source}</span>
                          {entry.official && <span className={kit.badge} data-fg>{t('skills.market.official')}</span>}
                          {installed && <span className={kit.badge} data-fg><Check size={11} strokeWidth={1.5} aria-hidden /> {t('skills.market.installedBadge')}</span>}
                        </div>
                      </div>
                      <div className={kit.resSide}>
                        <button type="button" className={`${kit.btn} ${kit.outline}`} disabled={installed || installingThis}
                          onClick={() => onMarketInstall(entry)} data-testid={`market-install-${entry.id}`}>
                          {installingThis ? t('skills.market.installing') : t('skills.market.install')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className={kit.secDesc}>{t('skills.market.advancedHint')}</p>
            <div className={kit.toolbar} data-testid="skill-market-row">
              <input className={kit.input} value={repo} onChange={(event) => onRepoChange(event.target.value)}
                placeholder={t('skills.market.placeholder')} aria-label={t('skills.market.advanced')}
                data-testid="skill-repo-input"
                disabled={installing}
                onKeyDown={(event) => { if (event.key === 'Enter') onInstall(); }} />
              <button type="button" className={`${kit.btn} ${kit.outline}`} disabled={!repo.trim() || installing}
                onClick={onInstall} data-testid="skill-install-btn">
                {installing ? t('skills.market.installing') : t('skills.market.install')}
              </button>
            </div>
          </section>

          <section className={kit.resGroup}>
            <div className={kit.resHead}>
              <h3><Sparkles size={14} strokeWidth={1.5} aria-hidden /> {t('skills.installed')}</h3>
              <span className={kit.count}>{skills.length}</span>
            </div>
            {skills.length === 0 ? (
              <div className={kit.emptyBox}>{t('skills.installedEmpty')}</div>
            ) : (
              <div className={kit.resList}>
                {skills.map((skill) => (
                  <div key={skill.path} className={kit.resItem} data-testid={`skill-row-${skill.name}`}>
                    <span className={kit.iconTile}><Sparkles strokeWidth={1.5} aria-hidden /></span>
                    <div className={kit.resMain}>
                      <div className={kit.titleRow}>
                        <code className={`${kit.resTitle} ${kit.mono}`}>{skill.name}</code>
                        {skill.bundled && <span className={kit.badge}>{t('skills.bundled')}</span>}
                        {skill.sourceLabel === 'agents' && <span className={kit.badge} data-fg>{t('skills.sourceAgents')}</span>}
                      </div>
                      <div className={kit.resDesc}>{skill.description}</div>
                      {(skill.triggers.length > 0 || skill.tools.length > 0) && (
                        <div className={kit.resDesc}>
                          {skill.triggers.length > 0 && <span>{t('skills.triggers')}: {skill.triggers.join(', ')}</span>}
                          {skill.tools.length > 0 && <span>{t('skills.allowedTools')}: {skill.tools.join(', ')}</span>}
                        </div>
                      )}
                      {skill.whenPaths.length > 0 && (
                        <div className={kit.resDesc}><span>{t('skills.whenPaths')}: {skill.whenPaths.join(', ')}</span></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {toolGroups.map((group) => (
            <section key={group.title} className={kit.resGroup}>
              <div className={kit.resHead}>
                <h3>{group.title}</h3>
                <span className={kit.count}>{group.tools.length}</span>
              </div>
              {group.tools.length === 0 ? (
                <div className={kit.emptyBox}>{t('skills.empty')}</div>
              ) : (
                <div className={kit.resList}>
                  {group.tools.map((tool) => (
                    <div key={tool.name} className={kit.resItem}>
                      <span className={kit.iconTile}><ToolIcon strokeWidth={1.5} aria-hidden /></span>
                      <div className={kit.resMain}>
                        <code className={`${kit.resTitle} ${kit.mono}`}>{tool.name}</code>
                        <div className={kit.resDesc}>{tool.description}</div>
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
