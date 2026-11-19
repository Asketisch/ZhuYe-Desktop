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
import { reflect_lookup_model_abilities } from '@/utils/commands/models';
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
          clearSubmittedDraft(text, activeId);
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
            const abilities = await reflect_lookup_model_abilities(spec).catch(() => null);
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
        const items: UserInputItem[] = [
          ...(value ? [{ type: 'text' as const, text: value }] : []),
          ...attachments.toUserInputItems(),
        ].filter(
          (item) => !stripImages || (item.type !== 'image' && item.type !== 'local_image'),
        );
        // 剥离后既无文本也无附件(纯图片消息) → 不发送,附件保留待用户处理。
        if (items.length === 0) return;
        // 首页尚未绑定会话：先创建并等待 ChatView 完成绑定，避免把首条
        // 消息投递到上一个会话的线程或未持久化的占位线程。
        if (!activeId) await ensureSessionReady(null);
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
    currentWorkspace,
    clearSubmittedDraft,
    ensureSessionReady,
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
