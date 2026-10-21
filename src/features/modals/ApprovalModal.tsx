/**
 * ApprovalModal —— 工具 / Hook 权限审批弹窗（聚焦版）。
 *
 * 行为契约(从原 modals/index.tsx 抽出):
 *   - title 按 kind 取 tool / hook 对应 i18n 标题。
 *   - 三按钮:tertiary Deny / secondary Approve-for-session / primary Approve(autoFocus)。
 *   - onClose 走 store `approve(kind, id, { deny: { reason: 'dismissed' } })`。
 *   - 内容仅渲染 toolName(若有)+ argsSummary(若有)+ hint 文案。
 *
 * 第四个动作「始终允许这条命令」(仅在能推导出安全规则时出现):
 * 把一条 allow 规则写进**核心的用户级权限文件**
 * (`~/.reflect/permissions.toml`)—— 落盘即生效(核心 resolver 每次
 * 评估都重读文件),且同一条规则会在 Settings → Permissions 可见。
 * 推导口径见 `allowRule.ts`(Bash = 整条命令精确匹配;只读工具 = 整个
 * 工具;写类工具不给按钮)。
 *
 * 注:plan 审批走独立的 `PlanReadyModal`(`approvePlan` + PlanApprovalChoice 三选一),
 * 不经过本 modal。
 */
import { useState } from 'react';
import { useAgentStore, type PendingApproval } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { reflect_add_permission_rule } from '@/utils/commands';
import { ModalShell } from './ModalShell';
import { deriveAllowRule } from './allowRule';
import s from './index.module.css';

export function ApprovalModal({ approval }: { approval: PendingApproval }) {
  const { t } = useI18n();
  const approve = useAgentStore((st) => st.approve);
  const [allowBusy, setAllowBusy] = useState(false);
  const [allowError, setAllowError] = useState<string | null>(null);
  const kindLabel =
    approval.kind === 'tool' ? t('modal.approval.toolTitle') : t('modal.approval.hookTitle');

  const allowRule =
    approval.kind === 'tool' ? deriveAllowRule(approval.toolName, approval.args) : null;

  const allowAlways = async () => {
    if (!allowRule) return;
    setAllowBusy(true);
    setAllowError(null);
    try {
      await reflect_add_permission_rule(allowRule);
      await approve(approval.kind, approval.id, 'approve');
    } catch (e) {
      setAllowError(e instanceof Error ? e.message : String(e));
    } finally {
      setAllowBusy(false);
    }
  };

  return (
    <ModalShell
      title={kindLabel}
      open={true}
      onClose={() => approve(approval.kind, approval.id, { deny: { reason: 'dismissed' } })}
      tertiaryAction={{
        label: t('modal.approval.deny'),
        onClick: () => approve(approval.kind, approval.id, { deny: { reason: 'denied by user' } }),
      }}
      secondaryAction={{
        label: t('modal.approval.always'),
        onClick: () => approve(approval.kind, approval.id, 'approve_for_session'),
      }}
      primaryAction={{
        label: t('modal.approval.allow'),
        onClick: () => approve(approval.kind, approval.id, 'approve'),
        autoFocus: true,
      }}
    >
      {approval.toolName && (
        <div className={s.codeBlock}>{approval.toolName}</div>
      )}
      {approval.argsSummary && (
        <pre className={s.argsBlock}>{approval.argsSummary}</pre>
      )}
      {allowRule && (
        <button
          type="button"
          className={s.allowAlwaysBtn}
          disabled={allowBusy}
          onClick={() => void allowAlways()}
          data-testid="approval-allow-always"
        >
          {allowRule.shellPattern
            ? t('modal.approval.allowAlwaysCmd', { cmd: allowRule.shellPattern })
            : t('modal.approval.allowAlwaysTool', { tool: allowRule.tool })}
        </button>
      )}
      {allowError && (
        <p className={s.errorText} data-testid="approval-allow-error">
          {allowError}
        </p>
      )}
      <p className={s.hint}>
        {t('modal.approval.hint')}
      </p>
    </ModalShell>
  );
}