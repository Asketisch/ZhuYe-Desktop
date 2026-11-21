/**
 * SettingsView —— 全屏两栏设置页（纯展示）。
 *
 * 布局：左 268px 分组导航（窄窗口收 68px 图标栏）+ 右侧圆角内容面板，
 * 内容列 max-width 896px 居中。分区内容经 slots 注入（features 层装配），
 * 本文件只负责壳层与分区骨架，不承载业务状态。
 *
 * 视觉规范见同目录 SettingsPage.module.css 头注释。
 */
import { ArrowLeft, Search, X } from 'lucide-react';
import type { SettingsPermissionMode, SettingsViewProps, UserApprovalPolicy } from '@/contracts/settings';
import { ALL_SECTIONS, GROUPS, GroupCard, Row, Segmented, Select } from './settingsKit';
import s from './SettingsPage.module.css';

/* ===== 分区注册表（分组 + 图标 + 文案键；顺序即导航顺序） ===== */

/* ===== 页面视图 ===== */

export function SettingsView({ t, locale, onLocaleChange, section, onSectionChange, rawToml,
  onTomlChange, onCommit, showSecrets, onToggleSecret, approvalPolicy, onApprovalPolicyChange,
  status, loading, configLoading, saving, permissionPending, saved, error, onOpenPrompts, onPermission,
  onSave, onClose, permissionMode, search, slots }: SettingsViewProps) {
  const { ConfigInfoLine, ConfigForm, GroupsSection, PermissionRulesSection, DisplaySection,
    NotificationsSection, ConfigHealthBanner, GuardStatsCard, SecurityScanCard, UpdatesSection,
    RemoteSection, MemorySection, AgentsSection, PluginsSection, McpSection, SkillsSection,
    HooksSection, UsageSection, PersonalizationSection } = slots;

  // 分区定义查找（纯数据，非 hook —— 渲染层边界禁 useMemo）。
  const activeDef = GROUPS.flatMap((g) => g.sections).find((sec) => sec.id === section)
    ?? GROUPS[0].sections[0];
  const searchOpen = search.open;
  const setSearchOpen = search.setOpen;
  // 结果过滤（渲染层普通表达式：注册表数据在 settingsKit，logic 层不可依赖界面资源）。
  const searchQuery = search.query.trim().toLowerCase();
  const searchResults = searchQuery
    ? ALL_SECTIONS.filter((sec) => t(sec.labelKey).toLowerCase().includes(searchQuery))
    : ALL_SECTIONS;

  const wide = activeDef.wide;

  return (
    <div className={s.page} data-enter data-testid="settings-page" data-active-section={section}>
      <aside className={s.side}>
        <div className={s.backRow}>
          <button type="button" className={s.backBtn} onClick={onClose} aria-label={t('settingsPage.back')} data-testid="settings-back">
            <ArrowLeft strokeWidth={1.5} aria-hidden />
            <span className="lbl">{t('settingsPage.back')}</span>
          </button>
        </div>
        <div className={s.searchRow}>
          <button type="button" className={s.searchBtn} onClick={() => setSearchOpen(true)} aria-label={t('settingsPage.search')} data-testid="settings-search">
            <Search strokeWidth={1.5} aria-hidden />
            <span className="lbl">{t('settingsPage.search')}</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>
        <nav className={s.nav} aria-label={t('settings.title')} data-testid="settings-nav">
          <div className={s.navGroups}>
            {GROUPS.map((group) => (
              <div key={group.id} role="group" aria-label={t(group.labelKey)} className={s.navGroup}>
                <div className={s.groupLabel}>{t(group.labelKey)}</div>
                {group.sections.map((sec) => {
                  const Icon = sec.icon;
                  const active = section === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      className={s.navBtn}
                      data-active={active || undefined}
                      aria-current={active ? 'page' : undefined}
                      data-testid={`settings-section-${sec.id}`}
                      onClick={() => onSectionChange(sec.id)}
                    >
                      <Icon size={16} strokeWidth={1.5} aria-hidden />
                      <span className="lbl">{t(sec.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
      </aside>

      <div className={s.panelWrap}>
        <div className={s.panel}>
          <div className={s.panelHead}>
            <span className={s.spacer} />
            {onClose && (
              <button type="button" className={`${s.btn} ${s.ghost} ${s.iconOnly}`} onClick={onClose} aria-label={t('common.close')} data-testid="settings-close">
                <X strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
          <main className={s.scroll}>
            <div className={s.content} data-wide={wide || undefined}>
              <div className={s.secHead}>
                <h2 className={s.secTitle}>{t(activeDef.labelKey)}</h2>
              </div>
              <div className={s.secBody}>
                {error && (
                  <div className={s.notice}>
                    <span>{error}</span>
                  </div>
                )}

                {section === 'general' && (
                  <GroupCard>
                    <Row label={t('settings.language')} description={t('settings.languageDesc')}>
                      <Select
                        value={locale}
                        ariaLabel={t('settings.language')}
                        onChange={(v) => onLocaleChange(v as 'en' | 'zh-CN')}
                        options={[
                          { value: 'en', label: t('settings.english') },
                          { value: 'zh-CN', label: t('settings.chinese') },
                        ]}
                      />
                    </Row>
                  </GroupCard>
                )}
                {section === 'general' && <NotificationsSection />}
                {section === 'general' && <ConfigInfoLine />}

                {section === 'appearance' && <DisplaySection />}

                {section === 'groups' && (
                  <GroupsSection
                    rawToml={rawToml}
                    onChange={onTomlChange}
                    // 模型组页操作即时落盘：仅改内存 state 的话，后端 config 不变，
                    // 模型选择器 / 状态徽标读到的仍是旧配置（「保存了却选不到」）。
                    onCommit={onCommit}
                    status={status}
                    loading={loading}
                  />
                )}

                {section === 'remote' && <div className={s.embed}><RemoteSection /></div>}
                {section === 'personalization' && <PersonalizationSection />}
                {section === 'memory' && <div className={s.embed}><MemorySection /></div>}
                {section === 'agents' && <div className={s.embed}><AgentsSection /></div>}
                {section === 'plugins' && <div className={s.embed}><PluginsSection /></div>}
                {section === 'mcp' && <div className={s.embed}><McpSection /></div>}
                {section === 'skills' && <div className={s.embed}><SkillsSection /></div>}
                {section === 'hooks' && <div className={s.embed}><HooksSection /></div>}
                {section === 'usage' && <div className={s.embed}><UsageSection /></div>}

                {section === 'behavior' && (
                  <>
                    <GroupCard>
                      {/* Permission mode 快捷控件(高频操作)—— 三段工作模式,弃用档
                          (accept_edits/bubble/deny/bypass)不再提供入口。 */}
                      <Row label={t('settings.permissionMode')} description={t('settings.permissionModeDesc')}>
                        <Segmented
                          value={permissionMode}
                          disabled={permissionPending}
                          onChange={(v) => onPermission(v as SettingsPermissionMode)}
                          options={[
                            { value: 'auto', label: 'auto' },
                            { value: 'prompt', label: 'prompt' },
                            { value: 'plan', label: 'plan' },
                          ]}
                        />
                      </Row>
                      <Row label={t('composer.controls.approval')} description={t('composer.controls.approval.hint')}>
                        <Select
                          value={approvalPolicy}
                          ariaLabel={t('composer.controls.approval')}
                          onChange={(v) => onApprovalPolicyChange(v as UserApprovalPolicy)}
                          options={[
                            { value: 'auto', label: t('composer.controls.approval.follow') },
                            { value: 'prompt', label: t('composer.controls.approval.prompt') },
                            { value: 'auto_approve', label: t('composer.controls.approval.auto') },
                            { value: 'full_access', label: t('composer.controls.approval.full') },
                          ]}
                        />
                      </Row>
                    </GroupCard>
                    <PermissionRulesSection />
                  </>
                )}

                {section === 'advanced' && (
                  <>
                    <GroupCard>
                      <Row label={t('promptLayers.title')} description={t('settingsPage.advanced.promptsDesc')}>
                        <button type="button" className={`${s.btn} ${s.outline}`} onClick={onOpenPrompts}>
                          {t('promptLayers.open')}
                        </button>
                      </Row>
                      <Row label={t('settings.configFields')} description={t('settings.configHelp')}>
                        <span />
                      </Row>
                      <div className={s.row}>
                        <ConfigForm
                          rawToml={rawToml}
                          onChange={onTomlChange}
                          showSecrets={showSecrets}
                          onToggleSecret={onToggleSecret}
                        />
                      </div>
                    </GroupCard>
                    {/* 原始 TOML 编辑器 —— 结构化表单的出口闸阀（未知键保底可编辑）。 */}
                    <GroupCard>
                      <div className={s.row}>
                        <textarea
                          className={`${s.textarea} ${s.textareaTall}`}
                          value={rawToml}
                          onChange={(e) => onTomlChange(e.target.value)}
                          spellCheck={false}
                          aria-label={t('settings.advancedRawToml', { title: t('settings.advanced') })}
                          data-testid="settings-raw-toml"
                        />
                      </div>
                    </GroupCard>
                    <ConfigHealthBanner />
                    <GuardStatsCard />
                    <SecurityScanCard />
                    <UpdatesSection />
                    <div className={s.saveBar}>
                      <button
                        type="button"
                        className={`${s.btn} ${s.primary} ${s.lg}`}
                        onClick={onSave}
                        disabled={saving || configLoading}
                        data-testid="settings-save"
                      >
                        {saved ? t('settings.saved') : t('settings.save')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      {searchOpen && (
        <div className={s.searchOverlay} onClick={() => setSearchOpen(false)} data-testid="settings-search-overlay">
          <div className={s.searchPop} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={search.query}
              placeholder={t('settingsPage.searchPlaceholder')}
              aria-label={t('settingsPage.search')}
              onChange={(e) => search.setQuery(e.target.value)}
              spellCheck={false}
            />
            <div className={s.searchList} role="listbox">
              {searchResults.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={s.searchItem}
                  role="option"
                  aria-selected={false}
                  onClick={() => search.jump(sec.id)}
                >
                  {t(sec.labelKey)}
                  <span className={s.group}>{t(sec.groupKey)}</span>
                </button>
              ))}
              {searchResults.length === 0 && (
                <div className={s.emptyBox}>{t('settingsPage.searchEmpty')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 兼容旧导出：权限模式三段按钮仍由行为分区以 Select 呈现。 */
export type { SettingsPermissionMode };
