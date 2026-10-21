/**
 * usePaletteActions —— AppShell 的命令面板动作编排。
 *
 * 把原来 AppShell 里 5 个 callback(`newSession` / `clearAllSessions` /
 * `exportActive` / `saveConfig` / `runSlash`)集中,只对 palette 入口使用。
 *
 * 行为契约(从 AppShell 抽出,不可变):
 *   - `newSession` 调 `handleNewChat`(创建路由到 /chat) + pushToast。
 *   - `clearAllSessions` 通过 qc 复用 sessions 缓存,无会话直接提示,否则逐个删除并
 *     invalidate,最后统计 toast。
 *   - `exportActive` 若无 active id 提示 warn;否则调 `reflect_export_session` 并 toast。
 *   - `exportActiveMarkdown` 同上,但调 `reflect_export_session_markdown`
 *     (核心 `to_markdown` 转录 + 用量小节)—— 此前该命令有后端无入口。
 *   - `saveConfig` 调 `reflect_save_config('')` 并 toast;失败提示。
 *   - `runSlash` 直接 fire-and-forget 调 `submit(slash)`,让 /compact 等命令无需输入。
 *
 * 入参 `t` / `tp` 由调用方传入(可在 I18nProvider 之外的测试场景中替换)。
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAgentStore } from '@/stores/agentStore';
import { executeSlash, parseSlash } from '@/features/composer/slashEngine';
import { dispatchSubmission } from '@/features/composer/dispatchSubmission';
import { useSessions } from '@/features/sessions/hooks/useSessions';
import { useEnsureSession } from '@/features/sessions/hooks/useEnsureSession';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/features/modals/ConfirmDialog';
import {
  reflect_export_session,
  reflect_export_session_markdown,
  reflect_save_config,
  reflect_list_sessions,
  reflect_delete_session,
} from '@/utils/commands';

export interface PaletteToasts {
  /** "新会话已启动。" */
  newSession: string;
  /** "没有可清除的会话。" */
  noSessionsToClear: string;
  /** 确认框标题（"清空全部会话"）。 */
  clearedSessionsLabel: string;
  /** 确认框正文："将删除 N 个会话及其历史文件，此操作不可撤销。" */
  clearAllConfirm: (count: number) => string;
  /** "删除失败：{msg}" */
  deleteFailed: (msg: string) => string;
  /** "已清除 N 个会话。"（支持复数） */
  clearedSessions: (count: number) => string;
  /** "没有可导出的活动会话。" */
  noActiveToExport: string;
  /** "已导出 → {path}" */
  exported: (path: string) => string;
  /** "已导出 →（无路径）" */
  exportedNoPath: string;
  /** "导出失败：{msg}" */
  exportFailed: (msg: string) => string;
  /** "已导出 Markdown → {path}" */
  exportedMarkdown: (path: string) => string;
  /** "已导出 Markdown →（无路径）" */
  exportedMarkdownNoPath: string;
  /** "配置已重新加载。" */
  configReloaded: string;
  /** "保存失败：{msg}" */
  saveFailed: (msg: string) => string;
}

export interface UsePaletteActionsOptions {
  activeId: string | null | undefined;
  onNewChat: () => void;
  toasts: PaletteToasts;
}

export interface UsePaletteActionsResult {
  newSession: () => void;
  clearAllSessions: () => Promise<void>;
  exportActive: () => Promise<void>;
  exportActiveMarkdown: () => Promise<void>;
  saveConfig: () => Promise<void>;
  runSlash: (slash: string) => void;
}

export function usePaletteActions(opts: UsePaletteActionsOptions): UsePaletteActionsResult {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const submit = useAgentStore((st) => st.submit);
  const pushToast = useAgentStore((st) => st.pushToast);
  const { rename } = useSessions();
  const ensureSessionReady = useEnsureSession();
  const { t } = useI18n();
  const { activeId, onNewChat, toasts } = opts;

  const newSession = useCallback(() => {
    onNewChat();
    pushToast({ kind: 'info', message: toasts.newSession });
  }, [onNewChat, pushToast, toasts.newSession]);

  const clearAllSessions = useCallback(async () => {
    const list = await qc.fetchQuery({
      queryKey: ['sessions'],
      queryFn: () => reflect_list_sessions(),
    });
    if (!Array.isArray(list) || list.length === 0) {
      pushToast({ kind: 'info', message: toasts.noSessionsToClear });
      return;
    }
    // 毁灭性批量删除,必须二次确认(与 Sidebar 单删的 confirmDialog 语义对齐)。
    const ok = await confirmDialog({
      title: toasts.clearedSessionsLabel,
      message: toasts.clearAllConfirm(list.length),
    });
    if (!ok) return;
    for (const s of list) {
      try {
        await reflect_delete_session(s.session_id);
      } catch (e) {
        pushToast({ kind: 'error', message: toasts.deleteFailed((e as Error).message) });
      }
    }
    await qc.invalidateQueries({ queryKey: ['sessions'] });
    pushToast({ kind: 'success', message: toasts.clearedSessions(list.length) });
  }, [qc, pushToast, toasts]);

  const exportActive = useCallback(async () => {
    if (!activeId) {
      pushToast({ kind: 'warn', message: toasts.noActiveToExport });
      return;
    }
    try {
      const path = await reflect_export_session(activeId);
      pushToast({
        kind: 'success',
        message: path ? toasts.exported(path) : toasts.exportedNoPath,
      });
    } catch (e) {
      pushToast({ kind: 'error', message: toasts.exportFailed((e as Error).message) });
    }
  }, [activeId, pushToast, toasts]);

  /**
   * 导出当前会话为 **Markdown 转录**（核心 `reflect_rollout::to_markdown`）。
   *
   * 与 `exportActive`(JSON 原始记录)并列 —— JSON 供程序消费,
   * Markdown 供人阅读/分享(带用量小节)。此前该命令存在但无任何
   * 界面入口,核心的 `to_markdown` 能力在 GUI 里完全用不到。
   */
  const exportActiveMarkdown = useCallback(async () => {
    if (!activeId) {
      pushToast({ kind: 'warn', message: toasts.noActiveToExport });
      return;
    }
    try {
      const result = await reflect_export_session_markdown(activeId);
      const path = result?.path ?? null;
      pushToast({
        kind: 'success',
        message: path ? toasts.exportedMarkdown(path) : toasts.exportedMarkdownNoPath,
      });
    } catch (e) {
      pushToast({ kind: 'error', message: toasts.exportFailed((e as Error).message) });
    }
  }, [activeId, pushToast, toasts]);

  const saveConfig = useCallback(async () => {
    try {
      await reflect_save_config('');
      pushToast({ kind: 'success', message: toasts.configReloaded });
    } catch (e) {
      pushToast({ kind: 'error', message: toasts.saveFailed((e as Error).message) });
    }
  }, [pushToast, toasts]);

  const runSlash = useCallback(
    (slash: string) => {
      // palette 触发 fire-and-forget 式执行。必须走 slashEngine 管线:
      // 此前直接 submit(slash) 会把 "/compact" 等当作普通文本发给模型
      // (后端不解析 slash 文本),既污染会话历史又不执行命令。
      void (async () => {
        try {
          const parsed = parseSlash(slash);
          if (parsed.isSlash) {
            const result = executeSlash(parsed, {
              activeSessionId: activeId ?? null,
              now: () => new Date(),
            });
            if (result.kind === 'submit_with_submission' && result.submission) {
              await dispatchSubmission(result.submission, parsed.args, {
                activeSessionId: activeId ?? null,
                pushToast,
                t,
                rename,
                ensureSessionReady: () => ensureSessionReady(activeId ?? null),
                invalidateSessions: () =>
                  void qc.invalidateQueries({ queryKey: ['sessions'] }),
                navigate: (to) => void navigate({ to }),
              });
            } else if (result.kind === 'submit') {
              await submit(result.payload ?? slash);
            } else if (result.kind === 'reject') {
              pushToast({ kind: 'error', message: result.message ?? '' });
            } else {
              pushToast({ kind: 'info', message: result.message ?? '' });
            }
          } else {
            await submit(parsed.raw);
          }
        } catch (e) {
          pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      })();
    },
    [activeId, pushToast, rename, submit, t, ensureSessionReady, qc, navigate],
  );

  return { newSession, clearAllSessions, exportActive, exportActiveMarkdown, saveConfig, runSlash };
}