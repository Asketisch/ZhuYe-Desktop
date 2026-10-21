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
} from '@/features/sessions/hooks/useSessions';
import { useEnsureSession } from '@/features/sessions/hooks/useEnsureSession';
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
  setBusy: (busy: boolean) => void;
  setSlashVisible: (visible: boolean) => void;
  focus: () => void;
  /** v1.x：当前工作区绝对路径；提交时注入 `ReflectSubmission.workspace`。 */
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

export function useComposerSubmission({
  text,
  attachments,
  history,
  setText,
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
  const runSubmission = useCallback(
    (kind: string, args: string[]) =>
      dispatchSubmission(kind, args, {
        activeSessionId: activeId,
        pushToast,
        t,
        rename,
        ensureSessionReady: () => ensureSessionReady(activeId),
        workspace: currentWorkspace ?? null,
        invalidateSessions: () => void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
        navigate: (to) => void navigate({ to }),
      }),
    [activeId, pushToast, rename, t, ensureSessionReady, currentWorkspace, qc, navigate],
  );

  return useCallback(async (options?: { reverseMode?: boolean }) => {
    const value = text.trim();
    if (!value && attachments.attachments.length === 0) return;

    // 单次反转：Shift+Cmd/Ctrl+Enter 时本次发送用对侧模式。
    const mode: SendMode = options?.reverseMode
      ? sendMode === 'queue'
        ? 'steer'
        : 'queue'
      : sendMode;

    setBusy(true);
    setText('');
    setSlashVisible(false);
    history.resetNavigation();
    try {
      // P3：`!` 终端直通 —— 本地执行，不进 agent 循环、不写会话历史；
      // 附件保留在输入框（用户可能接着补充说明再发送）。
      if (value.startsWith('!') && onBangCommand) {
        const command = value.slice(1).trim();
        if (command) {
          history.commit(value);
          await onBangCommand(command);
        } else {
          setText('!');
        }
        return;
      }
      const parsed = dispatch(value, { activeSessionId: activeId, now: () => new Date() });
      if ('kind' in parsed) {
        if (parsed.kind === 'submit_with_submission' && parsed.submission) {
          const match = /^(\/\S+)(?:\s+(.*))?$/.exec(value);
          const args = match?.[2] ? match[2].split(/\s+/) : [];
          await runSubmission(parsed.submission, args);
        } else if (parsed.kind === 'reject') {
          pushToast({ kind: 'error', message: parsed.message ?? t('composer.commandRejected') });
        } else if (parsed.kind === 'no-op') {
          pushToast({ kind: 'info', message: parsed.message ?? t('composer.commandHandled') });
        }
      } else {
        const items: UserInputItem[] = [
          ...(value ? [{ type: 'text' as const, text: value }] : []),
          ...attachments.toUserInputItems(),
        ];
        const running = selectIsTurnRunning(useAgentStore.getState());
        if (running && mode === 'steer') {
          // v1.4 A2 真·转向:不打断当前 run,下一个安全点注入;已完成
          // 的工具调用与既有上下文全部保留,模型带着进度从新指令继续。
          await useAgentStore.getState().steer(items, steerPriority(items));
          history.commit(value);
        } else if (running) {
          // Queue：留在前端队列（不发后端），turn 收尾后自动排空；
          // 队列消息在消息流底部可见、可编辑、可撤销。
          useAgentStore.getState().enqueueMessage(items, currentWorkspace ?? null);
        } else if (attachments.attachments.length > 0) {
          await useAgentStore.getState().submitItems(items, currentWorkspace ?? null);
          history.commit(value);
          void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        } else {
          await submit(value, currentWorkspace ?? null);
          history.commit(value);
          // 刷新侧边栏会话列表:新会话的首条消息会派生标题,
          // 不等下一次手动刷新/缓存过期即可见。
          void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        }
      }
      attachments.clear();
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
    currentWorkspace,
    focus,
    history,
    onBangCommand,
    pushToast,
    qc,
    runSubmission,
    sendMode,
    setBusy,
    setSlashVisible,
    setText,
    submit,
    t,
    text,
  ]);
}
