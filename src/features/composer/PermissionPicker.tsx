/**
 * PermissionPicker —— 底栏左侧的工作模式触发器 + 弹出菜单。
 *
 * 输入卡下方的控制行（思考深度 / 审批策略 / 权限三段）收进卡内后的
 * 权限入口：一个触发器（盾形图标 + 当前工作模式 + 箭头）带一锅里
 * 向上弹的菜单 —— 工作模式三段（计划 / 询问 / 默认）+ 审批策略四段。
 * 两套概念在菜单里分区单选，语义保持正交：工作模式经
 * `zhuye_set_permission_mode` 下发（事件回读），审批策略按会话存
 * localStorage 并在每次发送的 thread_settings 里携带。
 *
 * 审批策略为完全访问时触发器转警示色（告警盾）；**切入**完全访问
 * 弹确认框 —— 明确告知「不再确认」的后果后再落偏好。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Hand,
  NotebookPen,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Compass,
  Zap,
} from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readApprovalPolicy, writeApprovalPolicy, type UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import { confirmDialog } from '@/logic/modals/confirm';
import s from '@/render/composer/PermissionPicker.module.css';

/** 会话工作模式三段（wire: plan/prompt/auto）。 */
const MODES = [
  { value: 'plan', icon: NotebookPen, labelKey: 'composer.controls.perm.plan', descKey: 'composer.controls.planHint' },
  { value: 'prompt', icon: Hand, labelKey: 'composer.controls.perm.ask', descKey: 'composer.controls.askHint' },
  { value: 'auto', icon: ShieldCheck, labelKey: 'composer.controls.perm.auto', descKey: 'composer.controls.defaultHint' },
] as const;

/** 工具审批策略四段（按会话保存，发送时随 thread_settings 携带）。 */
const APPROVALS = [
  { value: 'auto', icon: Compass, labelKey: 'composer.controls.approval.follow' },
  { value: 'prompt', icon: Hand, labelKey: 'composer.controls.approval.prompt' },
  { value: 'auto_approve', icon: Zap, labelKey: 'composer.controls.approval.auto' },
  { value: 'full_access', icon: ShieldAlert, labelKey: 'composer.controls.approval.full' },
] as const;

export function PermissionPicker() {
  const { t } = useI18n();
  const permissionMode = useAgentStore((st) => st.permissionMode);
  const setPermissionMode = useAgentStore((st) => st.setPermissionMode);
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  const goalActive = useAgentStore((st) => st.goalActive);
  const goalSnapshot = useAgentStore((st) => st.goalSnapshot);
  const [approvalPolicy, setApprovalPolicy] = useState<UserApprovalPolicy>(() => readApprovalPolicy(sessionId));
  useEffect(() => { setApprovalPolicy(readApprovalPolicy(sessionId)); }, [sessionId]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭（与「+」菜单同款约定）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onPickMode = (mode: string) => {
    setOpen(false);
    void setPermissionMode(mode);
  };

  const onPickApproval = async (value: UserApprovalPolicy) => {
    setOpen(false);
    // 切入完全访问：先确认「不再确认」的后果（其余档直接生效）。
    if (value === 'full_access' && approvalPolicy !== 'full_access') {
      const ok = await confirmDialog({
        title: t('composer.perm.fullAccessTitle'),
        message: t('composer.perm.fullAccessMessage'),
        confirmLabel: t('composer.controls.approval.full'),
      });
      if (!ok) return;
    }
    setApprovalPolicy(value);
    writeApprovalPolicy(sessionId, value);
  };

  const fullAccess = approvalPolicy === 'full_access';
  const TriggerIcon = fullAccess ? ShieldAlert : Shield;
  const modeLabel =
    MODES.find((m) => m.value === permissionMode)?.labelKey ?? 'composer.controls.perm.auto';
  const title = [
    t('composer.controls.approval.hint'),
    fullAccess ? t('composer.perm.fullAccessTitle') : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={s.wrap} ref={wrapRef} data-testid="composer-permission-picker">
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-full-access={fullAccess || undefined}
        title={title}
        data-testid="composer-permission-trigger"
      >
        <Icon icon={TriggerIcon} size={14} />
        <span>{t(modeLabel)}</span>
        <Icon icon={ChevronDown} size={12} className={s.caret} />
      </button>
      {goalActive && (
        <span
          className={s.goalBadge}
          title={
            goalSnapshot
              ? t('composer.goalBadgeDetail', {
                  turns: goalSnapshot.turn_count,
                  tokens: goalSnapshot.tokens_used,
                  status: goalSnapshot.status,
                })
              : t('composer.goalBadge')
          }
          data-testid="composer-goal-badge"
        >
          🎯 {t('composer.goalBadgeLabel')}
        </span>
      )}

      {open && (
        <div className={s.menu} role="menu" data-testid="composer-permission-menu">
          <span className={s.menuLabel}>{t('composer.perm.modeLabel')}</span>
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="menuitemradio"
              aria-checked={permissionMode === mode.value || undefined}
              className={s.option}
              onClick={() => onPickMode(mode.value)}
              data-testid={`composer-perm-${mode.value}`}
            >
              <Icon icon={mode.icon} size={14} className={s.optionIcon} />
              <span className={s.optionText}>
                <span className={s.optionTitle}>{t(mode.labelKey)}</span>
                <span className={s.optionDesc}>{t(mode.descKey)}</span>
              </span>
              {permissionMode === mode.value && (
                <Icon icon={Check} size={14} className={s.optionCheck} />
              )}
            </button>
          ))}

          <div className={s.separator} role="separator" />
          <span className={s.menuLabel}>{t('composer.controls.approval')}</span>
          {APPROVALS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={approvalPolicy === option.value || undefined}
              className={s.option}
              onClick={() => void onPickApproval(option.value)}
              data-testid={`composer-approval-${option.value}`}
            >
              <Icon icon={option.icon} size={14} className={s.optionIcon} />
              <span className={s.optionText}>
                <span className={s.optionTitle}>{t(option.labelKey)}</span>
              </span>
              {approvalPolicy === option.value && (
                <Icon icon={Check} size={14} className={s.optionCheck} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
