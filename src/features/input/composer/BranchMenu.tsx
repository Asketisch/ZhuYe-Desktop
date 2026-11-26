/**
 * BranchMenu —— 输入卡顶栏的分支胶囊（正常态）与 worktree 起点分支选择器。
 *
 * - 正常态：列出本地分支（`zhuye_git_branches`，每次打开重取），点击即
 *   切换。脏树走「提交后重试」：确认弹窗列出未提交变更数，确认后
 *   `zhuye_git_stage([])`（add -A）+ checkpoint commit + 重试 checkout；
 *   git 自身拒绝（真实冲突）时把 stderr 透传 toast。
 * - worktree 意图激活时（`agentStore.worktreeIntent` 非 null），顶栏用
 *   `StartRefPicker` 替换本胶囊：只登记新 worktree 的起点分支（当前
 *   HEAD 或某个本地分支），不切主目录；意图在发送链路建树时消费。
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, GitBranch } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_git_branches, zhuye_git_stage, zhuye_git_commit, zhuye_git_checkout, type ZhuyeBranchInfo } from '@/utils/commands/git';
import { confirmDialog } from '@/logic/harness/modals/confirm';
import { useAgentStore } from '@/stores/agentStore';
import s from '@/render/input/composer/ComposerTopBar.module.css';

/** 分支很多时只展示前若干项，保持菜单紧凑。 */
const MAX_LISTED_BRANCHES = 30;

/** 脏树 checkpoint 提交的固定信息（提交信息恒为英文惯例，不入 i18n）。 */
const checkpointMessage = (branch: string) => `chore: checkpoint before switching to ${branch}`;

export function invalidateGitQueries(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['git-status'] });
  void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
}

interface BranchMenuProps {
  /** 当前分支名；null = 非 repo 或游离 HEAD（胶囊不渲染由父级决定）。 */
  currentBranch: string | null;
  /** 当前分支的未提交变更数（脏树「提交后重试」的确认依据）。 */
  dirtyCount: number;
  /** `↑N ↓N` 领先/落后摘要（无则空串）。 */
  aheadBehind: string;
}

export function BranchMenu({ currentBranch, dirtyCount, aheadBehind }: BranchMenuProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<ZhuyeBranchInfo[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 菜单每次打开都重取分支列表（终端里新切的分支即时可见）。
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    zhuye_git_branches()
      .then((list) => { if (!disposed) setBranches(list); })
      .catch(() => { if (!disposed) setBranches([]); });
    return () => { disposed = true; };
  }, [open]);

  // 点击外部关闭（与「+」菜单同款约定）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /** 切换分支：脏树先 checkpoint 提交再 checkout（git 拒绝时透传错误）。 */
  const switchBranch = async (target: string) => {
    setOpen(false);
    if (!target || target === currentBranch || switching) return;
    setSwitching(true);
    try {
      if (dirtyCount > 0) {
        const ok = await confirmDialog({
          title: t('composer.branch.dirtyTitle'),
          message: t('composer.branch.dirtyMessage', { count: dirtyCount, branch: target }),
          confirmLabel: t('composer.branch.commitAndSwitch'),
        });
        if (!ok) return;
        await zhuye_git_stage([]);
        await zhuye_git_commit(checkpointMessage(target));
      }
      await zhuye_git_checkout(target);
      pushToast({ kind: 'info', message: t('composer.branch.switched', { branch: target }) });
      invalidateGitQueries(qc);
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className={s.pillWrap} ref={wrapRef} data-testid="composer-branch-menu">
      <button
        type="button"
        className={s.pill}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={currentBranch ?? undefined}
        data-testid="composer-branch-pill"
      >
        <Icon icon={GitBranch} size={14} className={s.pillIcon} />
        <span className={s.pillLabel}>{currentBranch}</span>
        {aheadBehind && <span className={s.menuItemHint}>{aheadBehind}</span>}
        <Icon icon={ChevronDown} size={12} className={s.pillCaret} />
      </button>

      {open && (
        <div className={s.menu} role="menu" data-testid="composer-branch-list">
          {(branches ?? []).length === 0 && (
            <span className={s.menuEmpty}>{t('composer.branch.empty')}</span>
          )}
          <div className={s.menuScroll}>
            {(branches ?? []).slice(0, MAX_LISTED_BRANCHES).map((branch) => (
              <button
                key={branch.name}
                type="button"
                role="menuitemradio"
                aria-checked={branch.current || undefined}
                className={s.menuItem}
                title={branch.name}
                onClick={() => void switchBranch(branch.name)}
              >
                <span className={`${s.menuItemLabel} ${s.mono}`}>{branch.name}</span>
                {branch.current && dirtyCount > 0 && (
                  <span className={s.menuItemHint}>
                    {t('composer.branch.dirtyHint', { count: dirtyCount })}
                  </span>
                )}
                {branch.current && <Icon icon={Check} size={14} className={s.menuItemCheck} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StartRefPickerProps {
  /** 意图中已选的起点分支；null = 当前 HEAD。 */
  selectedRef: string | null;
  /** 主目录当前分支名（selectedRef 为 null 时的回显）。 */
  currentBranchLabel: string | null;
}

/**
 * worktree 起点分支选择器 —— 与分支胶囊同款几何（勾选 worktree 时
 * 原位替换，头部不跳变）。只登记意图，不切主目录。
 */
export function StartRefPicker({ selectedRef, currentBranchLabel }: StartRefPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<ZhuyeBranchInfo[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    zhuye_git_branches()
      .then((list) => { if (!disposed) setBranches(list); })
      .catch(() => { if (!disposed) setBranches([]); });
    return () => { disposed = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const setWorktreeIntent = useAgentStore((st) => st.setWorktreeIntent);
  const triggerLabel = selectedRef ?? currentBranchLabel ?? t('composer.branch.detachedHead');

  return (
    <div className={s.pillWrap} ref={wrapRef} data-testid="composer-startref-picker">
      <button
        type="button"
        className={s.pill}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="composer-startref-pill"
      >
        <Icon icon={GitBranch} size={14} className={s.pillIcon} />
        <span className={s.pillLabel}>{triggerLabel}</span>
        <Icon icon={ChevronDown} size={12} className={s.pillCaret} />
      </button>

      {open && (
        <div className={s.menu} role="menu" data-testid="composer-startref-list">
          <span className={s.menuLabel}>{t('composer.startref.title')}</span>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedRef === null || undefined}
            className={s.menuItem}
            onClick={() => { setOpen(false); setWorktreeIntent({ ref: null }); }}
          >
            <span className={s.menuItemLabel}>{t('composer.startref.currentHead', { ref: currentBranchLabel ?? t('composer.branch.detachedHead') })}</span>
            {selectedRef === null && <Icon icon={Check} size={14} className={s.menuItemCheck} />}
          </button>
          {(branches ?? []).length > 0 && (
            <>
              <div className={s.menuSeparator} role="separator" />
              <span className={s.menuLabel}>{t('composer.startref.localBranches')}</span>
            </>
          )}
          <div className={s.menuScroll}>
            {(branches ?? [])
              .filter((branch) => !branch.current)
              .slice(0, MAX_LISTED_BRANCHES)
              .map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedRef === branch.name || undefined}
                  className={s.menuItem}
                  title={branch.name}
                  onClick={() => { setOpen(false); setWorktreeIntent({ ref: branch.name }); }}
                >
                  <span className={`${s.menuItemLabel} ${s.mono}`}>{branch.name}</span>
                  {selectedRef === branch.name && <Icon icon={Check} size={14} className={s.menuItemCheck} />}
                </button>
              ))}
          </div>
          <p className={s.menuNote}>{t('composer.startref.note')}</p>
        </div>
      )}
    </div>
  );
}
