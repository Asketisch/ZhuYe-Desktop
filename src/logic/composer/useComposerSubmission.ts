import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { dispatch } from './slashEngine';
import { dispatchSubmission } from './dispatchSubmission';
import type { UseAttachmentsResult } from './useAttachments';
import { useAgent } from '@/services/agent';
import {
  useSessions,
  useActiveSession,
  SESSIONS_QUERY_KEY,
} from '@/logic/sessions/useSessions';
import { useEnsureSession } from '@/logic/sessions/useEnsureSession';
import { confirmDialog } from '@/logic/modals/confirm';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/shell/useCurrentWorkspace';
import { zhuye_lookup_model_abilities } from '@/utils/commands/models';
import { zhuye_create_worktree } from '@/utils/commands/git';
import { zhuye_set_workspace } from '@/utils/commands/workspaces';
import { useI18n } from '@/utils/i18n';
import {
  useAgentStore,
  selectIsTurnRunning,
} from '@/stores/agentStore';
import type { UserInputItem } from '@/types/protocol';
import type { PromptHistoryApi } from './usePromptHistory';

/** C：运行中发送的两种语义 —— 排队（默认,turn 收尾后送出）或转向（v1.4 A2 真·转向,安全点注入）。 */
export type SendMode = 'queue' | 'steer';

interface UseComposerSubmissionOptions {
  text: string;
  attachments: UseAttachmentsResult;
  history: PromptHistoryApi;
  setText: (text: string) => void;
  clearSubmittedDraft: (text: string, session: string | null) => void;
  setBusy: (busy: boolean) => void;
  setSlashVisible: (visible: boolean) => void;
  focus: () => void;
  /** v1.x：当前工作区绝对路径；提交时注入 `ZhuyeSubmission.workspace`。 */
  currentWorkspace?: string | null;
  /** C：Queue/Steer 模式（仅 turn 运行中发送时生效）。 */
  sendMode?: SendMode;
  /** P3：`!` 终端直通 —— 文本以 `!` 开头时本地执行，不进 agent 循环。 */
  onBangCommand?: (command: string) => Promise<void>;
}

/**
 * steer 模式(v1.4 A2 真·转向):不打断当前 run,消息经 `Op::Steer`
 * 进会话转向队列,正在跑的 turn 在下一个 pre_loop 安全点(工具调用
 * 之间)收割注入;无在飞 turn 时随下一个 UserInput turn 边界合并。
 * 注入不发协议事件 —— store.steer 内部乐观渲染。纯文本按 `now`
 * (用户中途说话)转向;带附件按 `attachment`(参考资料)转向。
 */
function steerPriority(items: UserInputItem[]): 'now' | 'attachment' {
  return items.every((item) => item.type === 'text') ? 'now' : 'attachment';
}

/** worktree 自动命名的本地时间戳段（如 `20261122-153045`）。 */
function worktreeTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function useComposerSubmission({
  text,
  attachments,
  history,
  setText,
  clearSubmittedDraft,
  setBusy,
  setSlashVisible,
  focus,
  currentWorkspace,
  sendMode = 'queue',
  onBangCommand,
}: UseComposerSubmissionOptions) {
  const { submit } = useAgent();
  const { activeId } = useActiveSession();
  const { rename } = useSessions();
  const ensureSessionReady = useEnsureSession();
  const pushToast = useAgentStore((state) => state.pushToast);
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // slash submission 分发已抽到 dispatchSubmission.ts（Composer 与命令面板共用）。
  // 与 send() 同款模型守卫 —— 命令面板的 /goal /plan 等同样会建会话。
  const modelGuardOk = () => {
    const status = qc.getQueryData<{ has_model?: boolean; model?: string }>([
      'agent-status',
    ]);
    if (!status) return true;
    const model = status.model ?? '';
    return status.has_model !== false && model !== '' && !model.startsWith('mock');
  };
  const runSubmission = useCallback(
    (kind: string, args: string[]) => {
      if (!modelGuardOk()) {
        pushToast({ kind: 'error', message: t('composer.noModelRuntime') });
        return Promise.resolve();
      }
      return dispatchSubmission(kind, args, {
        activeSessionId: activeId,
        pushToast,
        t,
        rename,
        ensureSessionReady: () => ensureSessionReady(activeId),
        workspace: currentWorkspace ?? null,
        invalidateSessions: () => void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
        navigate: (to) => void navigate({ to }),
      });
    },
    [activeId, pushToast, rename, t, ensureSessionReady, currentWorkspace, qc, navigate, modelGuardOk],
  );

  /**
   * worktree 隔离意图的发送前解析。
   *
   * 意图挂在「新建草稿」上（agentStore.worktreeIntent，顶栏开关写入），
   * 仅对**本条消息将创建新会话**的首发生效；已绑定会话的后续消息不做
   * 任何事。意图激活时：
   * - 首发是斜杠命令 → 拒绝发送（建树流程只面向普通对话首发）；
   * - 其余 → 建隔离 worktree（起点分支取意图 ref）→ 切 workspace →
   *   以 worktree 路径作本条提交的 workspace（会话归属由首条提交携带，
   *   与 Git 页「在此开会话」同链路）；意图一次性消费。
   * 建树/切 workspace 失败 → fail-closed：拦截发送并保留意图（用户
   * 排障后可直接重发）。
   *
   * 返回 `'abort'` = 本次发送被拦截；否则为发送应携带的 workspace。
   */
  const resolveSendWorkspace = useCallback(
    async (activeSessionId: string | null, value: string): Promise<string | null | 'abort'> => {
      const intent = useAgentStore.getState().worktreeIntent;
      if (!intent || activeSessionId) return currentWorkspace ?? null;
      if (value.startsWith('/')) {
        pushToast({ kind: 'error', message: t('composer.worktree.slashUnsupported') });
        return 'abort';
      }
      const name = `zhuye-${worktreeTimestamp()}`;
      try {
        const wt = await zhuye_create_worktree(name, intent.ref ?? undefined);
        // 切 workspace 后会话归属、侧栏过滤与 git 状态全部落到 worktree 上
        // （命令内部有切换队列，与 bind 的 waitForWorkspaceSwitches 对齐）。
        await zhuye_set_workspace(wt.path);
        void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
        void qc.invalidateQueries({ queryKey: ['git-status'] });
        useAgentStore.getState().setWorktreeIntent(null);
        pushToast({
          kind: 'info',
          message: t('composer.worktree.created', { name: wt.branch || name }),
        });
        return wt.path;
      } catch (error) {
        pushToast({
          kind: 'error',
          message: t('composer.worktree.createFailed', {
            msg: error instanceof Error ? error.message : String(error),
          }),
        });
        return 'abort';
      }
    },
    [currentWorkspace, pushToast, t, qc],
  );

  const send = useCallback(async (options?: { reverseMode?: boolean }) => {
    const value = text.trim();
    if (!value && attachments.attachments.length === 0) return;

    // 单次反转：Shift+Cmd/Ctrl+Enter 时本次发送用对侧模式。
    const mode: SendMode = options?.reverseMode
      ? sendMode === 'queue'
        ? 'steer'
        : 'queue'
      : sendMode;

    setBusy(true);
    setSlashVisible(false);
    history.resetNavigation();
    try {
      // 模型守卫:运行时解析到 mock 池(env `ZHUYE_MODEL=mock` /
      // `ZHUYE_PROVIDER=mock` 显式 opt-in,优先级高于配置文件)或无模型
      // 时,发送只会进占位线程即时失败并留下空会话(实测踩过)。
      // status 缓存缺失(查询未跑完)时放行 —— 不能因为状态未就绪而
      // 永远堵死发送;引擎侧失败仍有显式报错。
      if (!modelGuardOk()) {
        pushToast({ kind: 'error', message: t('composer.noModelRuntime') });
        return;
      }
      // P3：`!` 终端直通 —— 本地执行，不进 agent 循环、不写会话历史；
      // 附件保留在输入框（用户可能接着补充说明再发送）。
      if (value.startsWith('!') && onBangCommand) {
        const command = value.slice(1).trim();
        if (command) {
          history.commit(value);
          await onBangCommand(command);
          clearSubmittedDraft(text, activeId);
        } else {
          setText('!');
        }
        return;
      }
      // worktree 隔离意图:仅对将创建新会话的首发解析;'abort' = 拦截。
      const sendWorkspace = await resolveSendWorkspace(activeId, value);
      if (sendWorkspace === 'abort') return;
      const parsed = dispatch(value, { activeSessionId: activeId, now: () => new Date() });
      if ('kind' in parsed) {
        if (parsed.kind === 'submit_with_submission' && parsed.submission) {
          const match = /^(\/\S+)(?:\s+(.*))?$/.exec(value);
          const args = match?.[2] ? match[2].split(/\s+/) : [];
          await runSubmission(parsed.submission, args);
        } else if (parsed.kind === 'reject') {
          pushToast({ kind: 'error', message: parsed.message ?? t('composer.commandRejected') });
          return;
        } else if (parsed.kind === 'no-op') {
          pushToast({ kind: 'info', message: parsed.message ?? t('composer.commandHandled') });
        }
      } else {
        // 视觉降级(确认弹窗 + 剥离):当前模型**明确**不支持视觉且带图片
        // → 确认后剥离图片继续发送,取消则不发(附件保留)。
        // `supports_vision === null`(目录没说)不拦截 —— 未知不是否定。
        const hasImages = attachments.attachments.some(
          (a) => a.attachment.kind === 'image' || a.attachment.kind === 'local_image',
        );
        let stripImages = false;
        if (hasImages) {
          const spec = useAgentStore.getState().prompt?.currentSpec?.trim();
          if (spec) {
            const abilities = await zhuye_lookup_model_abilities(spec).catch(() => null);
            if (abilities?.supports_vision === false) {
              const ok = await confirmDialog({
                title: t('composer.visionConfirmTitle'),
                message: t('composer.visionConfirmMessage', { model: spec }),
                confirmLabel: t('composer.visionConfirmSend'),
              });
              if (!ok) return;
              stripImages = true;
            }
          }
        }
        // 剥离在附件层完成(excludeImages):图片来源标记与图片同生同灭,
        // 不会留下孤儿文本。
        const items: UserInputItem[] = [
          ...(value ? [{ type: 'text' as const, text: value }] : []),
          ...attachments.toUserInputItems({ excludeImages: stripImages }),
        ];
        // 剥离后既无文本也无附件(纯图片消息) → 不发送,附件保留待用户处理。
        if (items.length === 0) return;
        // 计划挂起时发送文本 = 打回修订（revise 释放 plan gate）后把反馈
        // 以 steer 注入同一在飞回合 —— 模型带着反馈继续改计划，而不是把
        // 消息压进前端队列等回合结束。
        const pendingPlan = useAgentStore.getState().pendingPlan;
        if (pendingPlan) {
          await useAgentStore.getState().approvePlan(pendingPlan.id, 'revise');
        }
        // 首页尚未绑定会话：先创建并等待 ChatView 完成绑定，避免把首条
        // 消息投递到上一个会话的线程或未持久化的占位线程。
        if (!activeId) await ensureSessionReady(null);
        const running = selectIsTurnRunning(useAgentStore.getState());
        if (running && (mode === 'steer' || pendingPlan)) {
          // v1.4 A2 真·转向:不打断当前 run,下一个安全点注入;已完成
          // 的工具调用与既有上下文全部保留,模型带着进度从新指令继续。
          // 计划反馈强制走 steer：turn 正阻塞在 plan gate 上，排队只会在
          // 回合收尾后才送达，错过「继续规划」的语境。
          await useAgentStore.getState().steer(items, steerPriority(items));
          history.commit(value);
        } else if (running) {
          // Queue：留在前端队列（不发后端），turn 收尾后自动排空；
          // 队列消息在消息流底部可见、可编辑、可撤销。
          useAgentStore.getState().enqueueMessage(items, sendWorkspace);
        } else if (attachments.attachments.length > 0) {
          await useAgentStore.getState().submitItems(items, sendWorkspace);
          history.commit(value);
          void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        } else {
          await submit(value, sendWorkspace);
          history.commit(value);
          // 刷新侧边栏会话列表:新会话的首条消息会派生标题,
          // 不等下一次手动刷新/缓存过期即可见。
          void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        }
      }
      clearSubmittedDraft(text, activeId);
      attachments.clearSent(attachments.attachments);
    } catch (error) {
      console.error(error);
      pushToast({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      focus();
    }
  }, [
    activeId,
    attachments,
    clearSubmittedDraft,
    ensureSessionReady,
    focus,
    history,
    onBangCommand,
    pushToast,
    qc,
    resolveSendWorkspace,
    runSubmission,
    sendMode,
    setBusy,
    setSlashVisible,
    setText,
    submit,
    t,
    text,
  ]);

  /**
   * 直接执行一条 slash 命令（不经输入框）。
   *
   * 「+」菜单里的「压缩」等无参命令走这里：和发送路径同一套
   * slashEngine → dispatchSubmission 管线，避免把 "/compact" 当普通
   * 文本发给模型。
   */
  const runSlash = useCallback(
    async (command: string, args: string[] = []) => {
      const raw = `/${command}${args.length ? ` ${args.join(' ')}` : ''}`;
      const parsed = dispatch(raw, { activeSessionId: activeId, now: () => new Date() });
      if (!('kind' in parsed)) return;
      if (parsed.kind === 'submit_with_submission' && parsed.submission) {
        await runSubmission(parsed.submission, args);
      } else if (parsed.kind === 'reject') {
        pushToast({ kind: 'error', message: parsed.message ?? t('composer.commandRejected') });
      } else if (parsed.kind === 'no-op') {
        pushToast({ kind: 'info', message: parsed.message ?? t('composer.commandHandled') });
      }
    },
    [activeId, pushToast, runSubmission, t],
  );

  return { send, runSlash };
}
