import type { SettingsPermissionMode, SettingsViewProps, UserApprovalPolicy } from '@/contracts/settings';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '../design-system/Button';
import { Textarea } from '../design-system/Textarea';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { Select } from '../design-system/Select';
import s from './SettingsView.module.css';

export function SettingsView({ t, locale, onLocaleChange, section, onSectionChange, rawToml,
  onTomlChange, onCommit, showSecrets, onToggleSecret, approvalPolicy, onApprovalPolicyChange,
  status, loading, configLoading, saving, permissionPending, saved, error, onOpenPrompts, onPermission,
  onSave, onClose, slots }: SettingsViewProps) {
  const { ConfigInfoLine, ConfigForm, PlansSection, PermissionRulesSection, DisplaySection,
    NotificationsSection, ConfigHealthBanner, GuardStatsCard, SecurityScanCard, UpdatesSection } = slots;
  const hasModel = Boolean(status?.has_model);
  return (
    <div className={s.root}>
      <aside className={s.nav}>
        <h2 className={s.title}>{t('settings.title')}</h2>
        {/* 配置位置 / 分析健康度 / 活跃 agent —— 手改 config.toml 的用户
            需要知道「应用读的是哪个文件」;这些信息此前完全没有出口。 */}
        <ConfigInfoLine />
        <nav className={s.navList}>
          <NavBtn active={section === 'provider'} onClick={() => onSectionChange('provider')}>
            {t('settings.provider')}
          </NavBtn>
          <NavBtn active={section === 'plans'} onClick={() => onSectionChange('plans')}>
            {t('settings.nav.plans')}
          </NavBtn>
          <NavBtn active={section === 'permissions'} onClick={() => onSectionChange('permissions')}>
            {t('settings.permissions')}
          </NavBtn>
          <NavBtn active={section === 'display'} onClick={() => onSectionChange('display')}>
            {t('settings.nav.display')}
          </NavBtn>
          <NavBtn active={section === 'notifications'} onClick={() => onSectionChange('notifications')}>
            {t('settings.nav.notifications')}
          </NavBtn>
          <NavBtn active={section === 'advanced'} onClick={() => onSectionChange('advanced')}>
            {t('settings.advanced')}
          </NavBtn>
        </nav>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} className={s.closeBtn}>
            {t('common.close')}
          </Button>
        )}
      </aside>

      <main className={s.content}>
        {error && (
          <div className={s.errorBar}>
            <Icon icon={AlertTriangle} size={14} />
            <span>{error}</span>
          </div>
        )}

        {section === 'provider' && (
          <section>
            {/* 状态徽标 —— 契约 'Agent ready'。只在该页显示:它反映的是
                provider 配置的就绪状态,与其他设置页无关。 */}
            <div className={s.statusBar} data-ok={hasModel || undefined}>
              <Icon icon={hasModel ? CheckCircle2 : AlertTriangle} size={14} />
              <span>
                {loading
                  ? t('settings.loading')
                  : hasModel
                    ? <>{t('settings.status.ready', { model: status?.model ?? '' })} <code className={s.codeInline}>{status?.model}</code></>
                    : <>{t('settings.status.degraded', { reason: status?.degraded_reason ?? t('settings.status.noProvider') })} {t('settings.status.noProviderHint')}</>}
              </span>
            </div>
            <h3 className={s.sectionTitle}>{t('settings.provider')}</h3>
            <Button onClick={onOpenPrompts}>
              {t('promptLayers.title')}
            </Button>
            <p className={s.sectionDesc}>
              {t('settings.providerDescription', { path: t('settings.providerPath') })}{' '}
              <code className={s.codeInline}>{t('settings.providerPath')}</code>.
            </p>

            <div className={s.fieldRow}>
              <label className={s.fieldLabel}>{t('settings.language')}</label>
              <Select
                value={locale}
                aria-label={t('settings.language')}
                onChange={(e) => onLocaleChange(e.target.value as 'en' | 'zh-CN')}
              >
                <option value="en">{t('settings.english')}</option>
                <option value="zh-CN">{t('settings.chinese')}</option>
              </Select>
            </div>

            <h4 className={s.sectionTitle}>{t('settings.configFields')}</h4>
            <p className={s.sectionDesc}>{t('settings.configHelp')}</p>
            <ConfigForm
              rawToml={rawToml}
              onChange={onTomlChange}
              showSecrets={showSecrets}
              onToggleSecret={onToggleSecret}
            />
          </section>
        )}

        {section === 'plans' && (
          <PlansSection
            rawToml={rawToml}
            onChange={onTomlChange}
            // Plans 页操作即时落盘：仅改内存 state 的话，后端 config 不变，
            // 模型选择器 / Models 页读到的仍是旧配置（「保存了却选不到」）。
            onCommit={onCommit}
          />
        )}

        {section === 'permissions' && (
          <section>
            {/* Permission mode 快捷控件(高频操作)—— 三段工作模式,弃用档
                (accept_edits/bubble/deny/bypass)不再提供入口。 */}
            <div className={s.quickPerm}>
              <span className={s.quickPermLabel}>{t('settings.permissionMode')}</span>
              <div className={s.quickPermBtns}>
                {(['auto', 'prompt', 'plan'] as SettingsPermissionMode[]).map((m) => (
                  <button
                    key={m}
                    className={s.quickPermBtn}
                    onClick={() => onPermission(m)}
                    disabled={permissionPending}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <h3 className={s.sectionTitle}>{t('settings.permissions')}</h3>
            <p className={s.sectionDesc}>
              {t('settings.permissionsDescription')}
            </p>
            <label>
              {t('composer.controls.approval')}{' '}
              <select value={approvalPolicy} title={t('composer.controls.approval.hint')} aria-label={t('composer.controls.approval')} onChange={(event) => {
                onApprovalPolicyChange(event.target.value as UserApprovalPolicy);
              }}>
                <option value="auto">{t('composer.controls.approval.follow')}</option>
                <option value="prompt">{t('composer.controls.approval.prompt')}</option>
                <option value="auto_approve">{t('composer.controls.approval.auto')}</option>
                <option value="full_access">{t('composer.controls.approval.full')}</option>
              </select>
            </label>
            <h4 className={s.sectionTitle}>{t('settings.commonModes')}</h4>
            <div className={s.permGrid}>
              <PermCard t={t} mode="auto" onClick={() => onPermission('auto')} />
              <PermCard t={t} mode="prompt" onClick={() => onPermission('prompt')} />
              <PermCard t={t} mode="plan" onClick={() => onPermission('plan')} />
            </div>
            {/* 生效的权限规则（核心三层 store）—— 权限「模式」之外的另一半：
                哪些工具被 allow / deny / ask。 */}
            <PermissionRulesSection />
          </section>
        )}

        {section === 'display' && <DisplaySection />}

        {section === 'notifications' && <NotificationsSection />}

        {section === 'advanced' && (
          <section>
            <h3 className={s.sectionTitle}>{t('settings.advancedRawToml', { title: t('settings.advanced') })}</h3>
            <p className={s.sectionDesc}>
              {t('settings.advancedDescription', { fn: t('settings.advancedValidationFn') })}{' '}
              <code className={s.codeInline}>{t('settings.advancedValidationFn')}</code>.
            </p>
            <Textarea
              value={rawToml}
              onChange={(e) => onTomlChange(e.target.value)}
              className={s.rawEditor}
              spellCheck={false}
            />
          </section>
        )}

        {/* F50:配置健康横幅(provider 未配 / guard 关闭 / 沙箱未启)。 */}
        <ConfigHealthBanner />

        {/* F01:注入防护裁决统计(prompt_guard 默认开启,拦了多少要看得见)。 */}
        <GuardStatsCard />

        {/* 安全扫描(cargo audit)—— 核心真实实现,GUI 此前只能开终端跑。 */}
        <SecurityScanCard />

        {/* 更新检查 —— 后端早有 reflect_check_update,界面此前无入口。 */}
        <UpdatesSection />

        <div className={s.saveBar}>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saving || configLoading}
            loading={saving}
          >
            {saved ? t('settings.saved') : t('settings.save')}
          </Button>
        </div>
      </main>
    </div>
  );
}

// ====== 子组件 ======

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={s.navBtn} data-active={active || undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function PermCard({ mode, onClick, t }: { mode: SettingsPermissionMode; onClick: () => void; t: SettingsViewProps['t'] }) {
  const variant = mode === 'auto' ? 'success' : mode === 'deny' ? 'danger' : mode === 'plan' ? 'info' : mode === 'accept_edits' ? 'success' : mode === 'bypass' ? 'danger' : 'warning';
  return (
    <button className={s.permCard} data-variant={variant} onClick={onClick}>
      <div className={s.permCardHeader}>
        <Badge variant={variant} solid>{mode}</Badge>
      </div>
      <p className={s.permDesc}>{t(`permissionMode.${mode}.desc`)}</p>
    </button>
  );
}
