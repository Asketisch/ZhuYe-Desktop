/**
 * slash submission 分发 —— `submit_with_submission` 类命令的唯一执行实现。
 *
 * 此前该 switch 只存在于 useComposerSubmission 内部,命令面板的 runSlash
 * 把 "/compact" 等字面文本 submit 给了模型(后端不解析 slash 文本)。
 * 抽到这里后 Composer 与命令面板共用同一条管线。
 */
import {
  reflect_compact,
  reflect_interrupt,
  reflect_enter_plan_mode,
  reflect_exit_plan_mode,
  reflect_enter_goal_mode,
  reflect_exit_goal_mode,
  reflect_set_effort,
  reflect_set_permission_mode,
  reflect_export_session,
} from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import type { LocaleKey } from '@/utils/i18n';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface DispatchSubmissionCtx {
  activeSessionId: string | null;
  pushToast: (input: { kind: ToastKind; message: string }) => void;
  t: (key: LocaleKey, vars?: Record<string, string | number>) => string;
  /** useSessions().rename —— /rename 需要落到会话列表缓存。 */
  rename: (id: string, name: string) => Promise<void>;
  /**
   * /goal：确保存在已绑定的会话（无会话时创建 + 导航 + 等 bind 完成），
   * 返回可安全提交 op 的 session id。由调用方（hook 层）经
   * `useEnsureSession` 提供 —— 路由导航只能在 hook 里做。
   */
  ensureSessionReady?: (activeId: string | null) => Promise<string>;
  /** /goal 首条消息携带的当前工作区（SessionMeta.workspace 归属用）。 */
  workspace?: string | null;
  /** /goal 首条消息会派生会话标题，提交后刷新会话列表缓存。 */
  invalidateSessions?: () => void;
  /**
   * 路由跳转（`/usage` 等「打开某个视图」类命令）。缺省时退化为 toast
   * 提示 —— 命令面板与 Composer 都提供。
   */
  navigate?: (to: string) => void;
}

/** 执行一个 slash submission kind。kind 来自 slashEngine.executeSlash 的结果。 */
export async function dispatchSubmission(
  kind: string,
  args: string[],
  ctx: DispatchSubmissionCtx,
): Promise<void> {
  const { activeSessionId, pushToast, t, rename } = ctx;
  switch (kind) {
    case 'compact':
      await reflect_compact();
      pushToast({ kind: 'info', message: t('composer.compactRequested') });
      break;
    case 'enter_plan_mode':
      await reflect_enter_plan_mode(args.join(' ') || 'unspecified');
      break;
    case 'exit_plan_mode':
      await reflect_exit_plan_mode();
      break;
    case 'start_goal': {
      // GUI 的 /goal = 开目标会话。core 的 EnterGoalMode 只挂载自校验
      // 控制器、不启动 turn —— 不先建会话/不发首条消息的话，循环永不
      // 开始（旧实现挂在首页幽灵线程上，表现为「什么都没发生」）。
      const goal = args.join(' ').trim();
      if (!ctx.ensureSessionReady) {
        pushToast({ kind: 'warn', message: t('composer.unhandledSlash', { kind }) });
        return;
      }
      await ctx.ensureSessionReady(activeSessionId);
      // 顺序敏感：先 arm 再发消息 —— 两个 op 经同一 mpsc 保序处理，
      // turn 结束时校验器必然已就位。
      await reflect_enter_goal_mode(goal);
      useAgentStore.getState().setGoalActive(true);
      await useAgentStore.getState().submit(goal, ctx.workspace ?? null);
      ctx.invalidateSessions?.();
      pushToast({
        kind: 'success',
        message: t('composer.goalStarted', { goal: goal.length > 40 ? `${goal.slice(0, 40)}…` : goal }),
      });
      break;
    }
    case 'exit_goal_mode':
      await reflect_exit_goal_mode();
      useAgentStore.getState().setGoalActive(false);
      break;
    case 'set_effort':
      await reflect_set_effort((args[0] ?? '').toLowerCase());
      break;
    case 'set_permission_mode':
      await reflect_set_permission_mode((args[0] ?? '').toLowerCase());
      break;
    case 'interrupt':
      await reflect_interrupt();
      break;
    case 'export_session':
      if (activeSessionId) {
        const path = await reflect_export_session(activeSessionId);
        pushToast({
          kind: 'info',
          message: path ? t('composer.exported', { path }) : t('composer.exportedNoPath'),
        });
      }
      break;
    case 'rename_session': {
      // /rename "My Name" 的引号在这里剥离,避免会话名带上字面引号。
      const name = args
        .join(' ')
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1')
        .trim();
      if (activeSessionId && name) await rename(activeSessionId, name);
      break;
    }
    // v1.6.1:提示词层 —— 展开面板并拉取层列表。应答 `prompt_list` 事件
    // 异步到达 → reducer 写 store.prompt → 面板渲染可用层/生效层。
    case 'prompt_list': {
      const store = useAgentStore.getState();
      store.openPromptPanel();
      await store.promptList();
      break;
    }
    // 模型级用量视图 —— 路由到 /usage(会话统计 + 按模型拆分)。
    case 'open_usage':
      if (ctx.navigate) {
        ctx.navigate('/usage');
      } else {
        pushToast({ kind: 'info', message: t('usage.title') });
      }
      break;
    default:
      pushToast({ kind: 'warn', message: t('composer.unhandledSlash', { kind }) });
  }
}
