/**
 * PermissionRulesSection —— 展示核心权限层的**生效规则**。
 *
 * 桌面端与 CLI 共用同一套三层 store,规则按数组序展示:
 *
 * | 作用域 | 来源 | 优先级 |
 * |---|---|---|
 * | `config` | `config.toml` 的 `[permissions]` 段 | 最高 |
 * | `project` | `<workspace>/.reflect/permissions.toml` | 中 |
 * | `user` | `~/.reflect/permissions.toml` | 最低 |
 *
 * 匹配语义是 **first-match-wins**:数组里靠前的规则先生效,deny 优先于
 * allow。因此这里按后端返回的顺序原样渲染,不做重排 —— 重排会误导用户
 * 判断「哪条先命中」。
 *
 * 本区块**只读**:改写规则仍走 config.toml / permissions.toml 手改
 * (与 CLI 一致,避免 GUI 写出的文件与手改格式漂移)。
 */
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw } from 'lucide-react';
import { Badge, Card, EmptyState, Icon, IconButton } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_list_permission_rules,
  type PermissionRuleInfo,
} from '@/utils/commands/permissions';
import s from './PermissionRulesSection.module.css';

const SCOPE_LABEL: Record<PermissionRuleInfo['scope'], string> = {
  config: 'settings.permRules.scopeConfig',
  project: 'settings.permRules.scopeProject',
  user: 'settings.permRules.scopeUser',
};

export function PermissionRulesSection() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['permission-rules'],
    queryFn: () => reflect_list_permission_rules(),
    staleTime: 10_000,
  });

  const rules = q.data ?? [];

  return (
    <div className={s.root} data-testid="settings-permission-rules">
      <div className={s.header}>
        <h4 className={s.title}>{t('settings.permRules.title')}</h4>
        <IconButton
          size="sm"
          variant="default"
          label={t('settings.permRules.refresh')}
          onClick={() => void q.refetch()}
        >
          <Icon icon={RefreshCw} size={12} />
        </IconButton>
      </div>
      <p className={s.desc}>{t('settings.permRules.desc')}</p>

      {q.isError ? (
        <Card level="flat" padding="sm">
          <p className={s.error}>
            {q.error instanceof Error ? q.error.message : String(q.error)}
          </p>
        </Card>
      ) : rules.length === 0 && !q.isLoading ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={ShieldCheck} />}
            title={t('settings.permRules.empty')}
            description={t('settings.permRules.emptyHint')}
          />
        </Card>
      ) : (
        <ul className={s.list}>
          {rules.map((r, i) => (
            <li key={`${r.scope}-${i}`} className={s.row} data-testid="permission-rule-row">
              <span className={s.action} data-action={r.action}>
                <Icon icon={actionIcon(r.action)} size={12} />
                {r.action}
              </span>
              <span className={s.tool}>
                {r.toolGlob ?? r.tool}
                {r.shellPattern && <code className={s.shell}>{r.shellPattern}</code>}
              </span>
              <Badge variant={r.scope === 'config' ? 'info' : 'neutral'}>
                {t(SCOPE_LABEL[r.scope])}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function actionIcon(action: string): typeof ShieldCheck {
  switch (action) {
    case 'deny':
      return ShieldAlert;
    case 'ask':
      return ShieldQuestion;
    default:
      return ShieldCheck;
  }
}
