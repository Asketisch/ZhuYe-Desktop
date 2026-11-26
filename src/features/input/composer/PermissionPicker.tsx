/**
 * PermissionPicker —— 底栏左侧的权限档触发器 + 弹出菜单（ZCode 同款三档）。
 *
 * 菜单只有三个单选项：
 * - **询问**（wire `prompt`）：可运行基本 bash；拦截删除等危险操作；
 *   不能修改文件（语义在上游审批门 `ask_mode` 判定）。
 * - **自主模式**（wire `auto`）：在有风险时询问。
 * - **完全访问**（审批策略 `full_access`）：减少确认次数；切入走确认弹窗。
 *
 * 计划不在此菜单 —— 入口在「+」菜单 / `/plan`。会话处于计划模式时三档
 * 都不勾选，菜单顶部显示一条非交互提示行。
 *
 * 选中态派生：审批策略为完全访问时优先显示「完全访问」（警示色）；
 * 否则按工作模式（计划 > 询问 / 自主模式）。工作模式经
 * `zhuye_set_permission_mode` 下发（事件回读），完全访问按会话存
 * localStorage 并在每次发送的 thread_settings 里携带；切三档中的模式档
 * 会把审批策略重置回「跟随模式」。
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
} from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readApprovalPolicy, writeApprovalPolicy, type UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import { writePermissionPreference } from '@/stores/agent/permissionPreference';
import { confirmDialog } from '@/logic/modals/confirm';
import s from '@/render/input/composer/PermissionPicker.module.css';

/** 权限三档（前两档 = wire 工作模式，第三档 = 审批策略完全访问）。 */
const TIERS = [
  { value: 'prompt', icon: Hand, labelKey: 'composer.controls.perm.ask', descKey: 'composer.controls.askHint' },
  { value: 'auto', icon: ShieldCheck, labelKey: 'composer.controls.perm.guarded', descKey: 'composer.controls.guardedHint' },
  { value: 'full_access', icon: ShieldAlert, labelKey: 'composer.controls.perm.full', descKey: 'composer.controls.fullHint' },
] as const;

type TierValue = (typeof TIERS)[number]['value'];

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

  // 选中档派生：完全访问优先；计划模式下三档均不选中。弃用档（store
  // 残留）同样无选中但不显示计划态提示（提示行只认 plan）。
  const selectedTier: TierValue | null =
    approvalPolicy === 'full_access' ? 'full_access' : permissionMode === 'prompt' || permissionMode === 'auto' ? permissionMode : null;
  const fullAccess = approvalPolicy === 'full_access';
  const planActive = !fullAccess && permissionMode === 'plan';

  const resetApproval = (sessionIdKey: string | null | undefined) => {
    setApprovalPolicy('auto');
    writeApprovalPolicy(sessionIdKey, 'auto');
  };

  const onPickMode = (mode: 'prompt' | 'auto') => {
    setOpen(false);
    // 记录用户显式选择：首页写入 'new' 键，待会话 id 落定后转正；
    // bind → replay 为空的新会话据此校准模式。模式档切换同时把审批
    // 策略重置回「跟随模式」—— 三档互斥，完全访问只经确认弹窗开启。
    writePermissionPreference(sessionId, mode);
    resetApproval(sessionId);
    void setPermissionMode(mode);
  };

  const onPickFullAccess = async () => {
    setOpen(false);
    // 切入完全访问：先确认「不再确认」的后果（退出无需确认）。
    if (!fullAccess) {
      const ok = await confirmDialog({
        title: t('composer.perm.fullAccessTitle'),
        message: t('composer.perm.fullAccessMessage'),
        confirmLabel: t('composer.controls.perm.full'),
      });
      if (!ok) return;
    }
    setApprovalPolicy('full_access');
    writeApprovalPolicy(sessionId, 'full_access');
  };

  const TriggerIcon = fullAccess ? ShieldAlert : Shield;
  const triggerLabelKey = fullAccess
    ? 'composer.controls.perm.full'
    : planActive
      ? 'composer.controls.perm.plan'
      : permissionMode === 'prompt'
        ? 'composer.controls.perm.ask'
        : 'composer.controls.perm.guarded';
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
        data-mode={permissionMode}
        title={title}
        data-testid="composer-permission-trigger"
      >
        <Icon icon={TriggerIcon} size={14} />
        <span>{t(triggerLabelKey)}</span>
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
          {planActive && (
            <span className={s.planHint} data-testid="composer-perm-plan-hint">
              <Icon icon={NotebookPen} size={12} />
              {t('composer.controls.perm.planActiveHint')}
            </span>
          )}
          {TIERS.map((tier) => (
            <button
              key={tier.value}
              type="button"
              role="menuitemradio"
              aria-checked={selectedTier === tier.value || undefined}
              className={s.option}
              onClick={() => (tier.value === 'full_access' ? void onPickFullAccess() : onPickMode(tier.value))}
              data-testid={`composer-perm-${tier.value}`}
            >
              <Icon icon={tier.icon} size={14} className={s.optionIcon} />
              <span className={s.optionText}>
                <span className={s.optionTitle}>{t(tier.labelKey)}</span>
                <span className={s.optionDesc}>{t(tier.descKey)}</span>
              </span>
              {selectedTier === tier.value && (
                <Icon icon={Check} size={14} className={s.optionCheck} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
