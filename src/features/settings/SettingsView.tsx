/**
 * Settings —— IDE 式二级导航 + 卡片内容（CSS Modules 版）。
 *
 * 左侧二级 nav:Provider / Permissions / Advanced。
 * 右侧内容区:对应 section 的卡片化表单。
 *
 * 契约（SettingsView.test.tsx）：
 *   - 'Settings' / 'Provider' / 'Permissions' / 'Advanced' 文字
 *   - 'Agent ready' 状态徽标
 *   - permission 按钮 'plan' 触发 reflect_set_permission_mode
 *   - 'Save to ~/.reflect/config.toml' 按钮触发 reflect_save_config
 *
 * 实际渲染使用 ConfigForm —— 它覆盖了 ReflectConfig 的 25+ 配置段,
 * 见 reflect-agent/crates/resources/reflect-config/src/schema.rs。Advanced TOML 编辑器仍然是
 * 逃生口,所有未知字段都会保留。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  reflect_get_config,
  reflect_save_config,
  reflect_agent_status,
  reflect_set_permission_mode,
} from '@/utils/commands';
import { Button, Textarea, Badge, Icon, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { ConfigForm } from './ConfigForm';
import { DisplaySection } from './sections/DisplaySection';
import { NotificationsSection } from './sections/NotificationsSection';
import { PlansSection } from './sections/PlansSection';
import { PermissionRulesSection } from './sections/PermissionRulesSection';
import { ConfigInfoLine } from './sections/ConfigInfoLine';
import { SecurityScanCard } from './sections/SecurityScanCard';
import { UpdatesSection } from './sections/UpdatesSection';
import s from './SettingsView.module.css';

type PermissionMode = 'auto' | 'prompt' | 'deny' | 'plan' | 'accept_edits' | 'bubble' | 'bypass';
type Section = 'provider' | 'plans' | 'permissions' | 'display' | 'notifications' | 'advanced';

export function SettingsView({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>('provider');
  const [rawToml, setRawToml] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const { t, locale, setLocale } = useI18n();

  // 未保存编辑保护：configQuery staleTime=0 + 窗口聚焦 refetch，会让
  // useEffect 无条件 setRawToml(data) 把用户正在编辑的内容冲掉。
  // 记录最近一次 seed 值与脏标记：只在缓冲未被修改（或刚保存成功）时接受刷新。
  const seededRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const updateRawToml = useCallback((next: string) => {
    setRawToml(next);
    dirtyRef.current = next !== seededRef.current;
  }, []);

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: reflect_get_config,
    staleTime: 0,
  });
  const statusQuery = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
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
    mutationFn: async (toml: string) => reflect_save_config(toml),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
      // 保存成功后以当前缓冲为基准，后续 refetch 可以安全覆盖。
      seededRef.current = rawToml;
      dirtyRef.current = false;
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['agent-status'] });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const permMutation = useMutation({
    mutationFn: async (mode: string) => reflect_set_permission_mode(mode),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const onSave = () => saveMutation.mutate(rawToml);
  const onPermission = (mode: PermissionMode) => permMutation.mutate(mode);

  const status = statusQuery.data;
  const hasModel = Boolean(status?.has_model);

  const toggleSecret = (key: string) => setShowSecrets((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className={s.root}>
      <aside className={s.nav}>
        <h2 className={s.title}>{t('settings.title')}</h2>
        {/* 配置位置 / 分析健康度 / 活跃 agent —— 手改 config.toml 的用户
            需要知道「应用读的是哪个文件」;这些信息此前完全没有出口。 */}
        <ConfigInfoLine />
        <nav className={s.navList}>
          <NavBtn active={section === 'provider'} onClick={() => setSection('provider')}>
            {t('settings.provider')}
          </NavBtn>
          <NavBtn active={section === 'plans'} onClick={() => setSection('plans')}>
            {t('settings.nav.plans')}
          </NavBtn>
          <NavBtn active={section === 'permissions'} onClick={() => setSection('permissions')}>
            {t('settings.permissions')}
          </NavBtn>
          <NavBtn active={section === 'display'} onClick={() => setSection('display')}>
            {t('settings.nav.display')}
          </NavBtn>
          <NavBtn active={section === 'notifications'} onClick={() => setSection('notifications')}>
            {t('settings.nav.notifications')}
          </NavBtn>
          <NavBtn active={section === 'advanced'} onClick={() => setSection('advanced')}>
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
                {configQuery.isLoading || statusQuery.isLoading
                  ? t('settings.loading')
                  : hasModel
                    ? <>{t('settings.status.ready', { model: status?.model ?? '' })} <code className={s.codeInline}>{status?.model}</code></>
                    : <>{t('settings.status.degraded', { reason: status?.degraded_reason ?? t('settings.status.noProvider') })} {t('settings.status.noProviderHint')}</>}
              </span>
            </div>
            <h3 className={s.sectionTitle}>{t('settings.provider')}</h3>
            <p className={s.sectionDesc}>
              {t('settings.providerDescription', { path: t('settings.providerPath') })}{' '}
              <code className={s.codeInline}>{t('settings.providerPath')}</code>.
            </p>

            <div className={s.fieldRow}>
              <label className={s.fieldLabel}>{t('settings.language')}</label>
              <Select
                value={locale}
                aria-label={t('settings.language')}
                onChange={(e) => setLocale(e.target.value as 'en' | 'zh-CN')}
              >
                <option value="en">{t('settings.english')}</option>
                <option value="zh-CN">{t('settings.chinese')}</option>
              </Select>
            </div>

            <h4 className={s.sectionTitle}>{t('settings.configFields')}</h4>
            <p className={s.sectionDesc}>{t('settings.configHelp')}</p>
            <ConfigForm
              rawToml={rawToml}
              onChange={updateRawToml}
              showSecrets={showSecrets}
              onToggleSecret={toggleSecret}
            />
          </section>
        )}

        {section === 'plans' && (
          <PlansSection
            rawToml={rawToml}
            onChange={updateRawToml}
            // Plans 页操作即时落盘：仅改内存 state 的话，后端 config 不变，
            // 模型选择器 / Models 页读到的仍是旧配置（「保存了却选不到」）。
            onCommit={(next) => {
              updateRawToml(next);
              saveMutation.mutate(next);
            }}
          />
        )}

        {section === 'permissions' && (
          <section>
            {/* Permission mode 快捷控件（高频操作）—— 4 个常用模式，高级模式见 /mode 命令。
                只在该页显示,避免每个设置页签都重复。 */}
            <div className={s.quickPerm}>
              <span className={s.quickPermLabel}>{t('settings.permissionMode')}</span>
              <div className={s.quickPermBtns}>
                {(['auto', 'prompt', 'deny', 'plan'] as PermissionMode[]).map((m) => (
                  <button
                    key={m}
                    className={s.quickPermBtn}
                    onClick={() => onPermission(m)}
                    disabled={permMutation.isPending}
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
            <h4 className={s.sectionTitle}>{t('settings.commonModes')}</h4>
            <div className={s.permGrid}>
              <PermCard mode="auto" onClick={() => onPermission('auto')} />
              <PermCard mode="prompt" onClick={() => onPermission('prompt')} />
              <PermCard mode="deny" onClick={() => onPermission('deny')} />
              <PermCard mode="plan" onClick={() => onPermission('plan')} />
            </div>
            <h4 className={s.sectionTitle}>{t('settings.advancedModes')}</h4>
            <div className={s.permGrid}>
              <PermCard mode="accept_edits" onClick={() => onPermission('accept_edits')} />
              <PermCard mode="bubble" onClick={() => onPermission('bubble')} />
              {/* bypass 不再提供：core v1.3 安全基线把 SetPermissionMode(Bypass)
                  一律降级 Prompt，UI 提供该选项只会造成「切了没生效」的错觉。 */}
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
              onChange={(e) => updateRawToml(e.target.value)}
              className={s.rawEditor}
              spellCheck={false}
            />
          </section>
        )}

        {/* 安全扫描(cargo audit)—— 核心真实实现,GUI 此前只能开终端跑。 */}
        <SecurityScanCard />

        {/* 更新检查 —— 后端早有 reflect_check_update,界面此前无入口。 */}
        <UpdatesSection />

        <div className={s.saveBar}>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saveMutation.isPending || configQuery.isLoading}
            loading={saveMutation.isPending}
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

function PermCard({ mode, onClick }: { mode: PermissionMode; onClick: () => void }) {
  const { t } = useI18n();
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