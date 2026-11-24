import { useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { ChatSlots, ChatViewProps } from '@/contracts/chat';
import { emitComposerPrefill } from '@/logic/composer/useComposerDraft';
import { useAgentStore, selectIsTurnRunning } from '@/stores/agentStore';
import { useBackgroundSessions } from '@/stores/backgroundSessions';
import { syncSessionPromptSelection, syncPlanPresetPermissionMode } from '@/stores/agent/promptSelection';
import { syncPreferredPermissionMode } from '@/stores/agent/permissionPreference';
import { syncEffortPreference } from '@/stores/agent/effortPreference';
import { userItemsFromTurn } from '@/stores/agent/turns';
import { zhuye_replay_session, zhuye_git_diff } from '@/utils/commands';
import { zhuye_bind_session, zhuye_fork_session, zhuye_export_session_markdown } from '@/utils/commands/sessions';
import type { PendingGateSnapshot } from '@/types/protocol';
import { useCurrentWorkspace } from '@/logic/shell/useCurrentWorkspace';
import { useActiveSession, useSessions } from '@/logic/sessions/useSessions';
import { useUiPrefs } from '@/logic/preferences/uiPrefs';
import type { ZhuyeRolloutRecord } from '@/utils/types';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/logic/modals/confirm';
import { useAutoSessionTitle } from '@/logic/sessions/useAutoSessionTitle';
import { useGitSummary } from './gitSummary';
import { useZShell } from '@/logic/shell/shellState';
import { useShellUi } from '@/stores/shellUi';

/**
 * v1.11 F7+D6:编辑历史消息的 rewind 目标推算(纯函数,导出供行为测试
 * 直接锁定**真实实现**,防测试内复刻逻辑漂移)。
 *
 * 语义:引擎 `truncate_after(to_turn_id)` 丢弃该 turn **含**及其之后的
 * 记录(recorder.rs / writer.rs::truncate_content)—— 因此回退目标恒为
 * 目标轮自身的 id:丢弃「目标轮及之后」,改完重发即从该点重新生成,
 * 此前的轮次完整保留。(此前 index>0 时误传前一轮 id,会连带删掉前一轮;
 * 与引擎对齐后修正。)返回 `null` 表示该轮没有用户文本,不可编辑。
 */
export function editRewindTargetFor(
  turns: { id: string; items: { kind: string; text?: string }[] }[],
  turnId: string,
): { rewindTo: string; userText: string } | null {
  const index = turns.findIndex((tr) => tr.id === turnId);
  if (index === -1) return null;
  const userItem = turns[index].items.find((it) => it.kind === 'user_text');
  if (!userItem || userItem.kind !== 'user_text') return null;
  return { rewindTo: turnId, userText: userItem.text ?? '' };
}

/**
 * Tauri 命令 reject 的 `CommandError` 经 IPC 序列化为 `{ msg }` 对象 ——
 * 直接 `String(e)` 会渲染成 "[object Object]"(实测:点击侧栏子代理会话,
 * bind 被 workspace 校验拒绝时错误条不可读)。统一解包成可读文本。
 * 导出供同切片的只读查看器(SubagentViewer)复用。
 */
export function commandErrorMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  const msg = (e as { msg?: unknown } | null)?.msg;
  return typeof msg === 'string' ? msg : String(e);
}

/**
 * 把旧会话降级进后台注册表:播种它在飞回合的实时投影与待确认交互。
 *
 * 为什么必须播种整份投影:
 * - **在飞历史**:引擎只在回合**结束**时才把 assistant 消息落进
 *   rollout。回合未结束(阻塞在 plan 审批等)时,解析 session 文件复现
 *   不出助手历史 —— 唯一能救回这段内容的是内存里的实时投影。
 * - **待确认交互**:审批 / 提问 / plan 是 gate 请求,**压根不落盘**,
 *   只能靠内存投影跨会话切换存活(否则切回后审批框消失,回合永远
 *   挂着,连停止按钮都随之消失)。
 *
 * 无在飞工作(回合已收尾)的会话:rollout 即完整事实源,不留内存
 * 投影 —— 避免注册表随访问过的会话数无限膨胀。
 */
function demotePreviousSession(): void {
  const state = useAgentStore.getState();
  const previous = state.loadedSessionId;
  if (!previous) return;
  const hasPending =
    state.pendingApprovals.length > 0 ||
    state.pendingQuestions.length > 0 ||
    state.pendingAskUser.length > 0 ||
    state.pendingPlan !== null;
  const running = state.turns.some((turn) => turn.status === 'streaming');
  if (!running && !hasPending) {
    useBackgroundSessions.getState().clearSession(previous);
    return;
  }
  useBackgroundSessions.getState().demote(previous, {
    turns: state.turns,
    pendingApprovals: state.pendingApprovals,
    pendingQuestions: state.pendingQuestions,
    pendingAskUser: state.pendingAskUser,
    pendingPlan: state.pendingPlan,
  });
}

/** 绑定会话回放、操作与可替换的聊天视图。 */
export function ChatBinding({ view: View, slots }: { view: ComponentType<ChatViewProps>; slots: ChatSlots }) {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  // v1.x:?sub=<childId> —— 侧栏子代理会话行落入的只读查看器目标。
  // 子会话不可 bind(引擎宿主拒绝),查看器走纯 replay,主 store 不动。
  const search = useSearch({ strict: false }) as { sub?: string };
  const subTarget = typeof search?.sub === 'string' && search.sub && search.sub !== sessionId
    ? search.sub
    : undefined;
  // B：本会话首个 turn 完成后自动生成 AI 标题（后端幂等，失败静默）。
  useAutoSessionTitle(sessionId);
  const turns = useAgentStore((st) => st.turns);
  const loadedSessionId = useAgentStore((st) => st.loadedSessionId);
  const hydrateSession = useAgentStore((st) => st.hydrateSession ?? (() => {}));
  const clearSession = useAgentStore((st) => st.clearSession ?? (() => {}));
  const syncPermissionMode = useAgentStore((st) => st.syncPermissionMode);
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const sessionEpoch = useRef({ id: sessionId, value: 0 });
  // v1.12:bind 返回的引擎侧挂起交互快照暂存位 —— mergePendingInto
  // (整体替换 pending)之后才水合,暂存到闭包 ref 跨两个 then 传递。
  const bindGatesRef = useRef<PendingGateSnapshot[] | null>(null);
  if (sessionEpoch.current.id !== sessionId) {
    sessionEpoch.current = { id: sessionId, value: sessionEpoch.current.value + 1 };
  }
  useEffect(() => () => { sessionEpoch.current.value += 1; }, []);

  // 会话横幅的 Fork 入口:一键把当前会话完整历史复制为子会话并切换过去。
  // 分支名用 CLI 同款默认 `manual`(侧边栏菜单入口可自定义;子会话可再改名)。
  // 按轮 fork(`upToTurnId` 截至该轮含,见 MessageList)复用同一处理链。
  const { setActiveId } = useActiveSession();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [forking, setForking] = useState(false);
  const handleFork = (branch: string, upToTurnId?: string) => {
    if (!sessionId || forking) return;
    const epoch = sessionEpoch.current.value;
    setForking(true);
    zhuye_fork_session(sessionId, branch, upToTurnId)
      .then((child) => {
        pushToast({ kind: 'success', message: t('chat.forked', { id: child }) });
        if (sessionEpoch.current.value === epoch) setActiveId(child);
      })
      .catch((e: unknown) => {
        pushToast({
          kind: 'error',
          message: t('chat.forkFailed', { msg: e instanceof Error ? e.message : String(e) }),
        });
      })
      .finally(() => setForking(false));
  };

  // v1.5:对话回退 —— Op::Rewind { to_turn_id } 丢弃该 turn(含)之后的
  // rollout 记录,引擎下一轮从更短历史回放;writer 侧先写 .bak 备份。
  const rewind = useAgentStore((st) => st.rewind);
  const handleRewind = async (turnId: string) => {
    const epoch = sessionEpoch.current.value;
    const ok = await confirmDialog({
      title: t('chat.rewindConfirmTitle'),
      message: t('chat.rewindConfirmMessage'),
    });
    if (!ok || !sessionId || epoch !== sessionEpoch.current.value ||
        useAgentStore.getState().loadedSessionId !== sessionId) return;
    try {
      await rewind(turnId);
      pushToast({ kind: 'success', message: t('chat.rewound') });
    } catch (e: unknown) {
      pushToast({
        kind: 'error',
        message: t('chat.rewindFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  // v1.11 F7+D6:编辑历史消息 —— 组合既有 Op::Rewind 与 composer 预填:
  // 截断「目标轮(含)之后」的全部记录,再把该轮用户文本填回 composer,
  // 用户改完直接发送 = 从该点重新生成。零协议改动(Rewind 语义已覆盖
  // 「截断 + 短历史回放」)。
  const handleEditTurn = async (turnId: string) => {
    const epoch = sessionEpoch.current.value;
    const target = editRewindTargetFor(turns, turnId);
    if (target === null) {
      // 轮不存在(静默)或没有用户文本(info 提示)都不可编辑。
      if (turns.some((tr) => tr.id === turnId)) {
        pushToast({ kind: 'info', message: t('chat.editNoUserText') });
      }
      return;
    }
    const ok = await confirmDialog({
      title: t('chat.editConfirmTitle'),
      message: t('chat.editConfirmMessage'),
    });
    if (!ok || !sessionId || epoch !== sessionEpoch.current.value ||
        useAgentStore.getState().loadedSessionId !== sessionId) return;
    try {
      await rewind(target.rewindTo);
      emitComposerPrefill(target.userText);
      pushToast({ kind: 'success', message: t('chat.editPrefilled') });
    } catch (e: unknown) {
      pushToast({
        kind: 'error',
        message: t('chat.rewindFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  // C2 一键重生成:Rewind(丢弃目标轮含之后,与编辑同款引擎语义)+
  // 把该轮用户内容(user_text + 附件)原样重发 —— 编辑流的「免改直发」
  // 变体。附件经 userItemsFromTurn 逆转回 UserInputItem(image 的 data-URL
  // 由后端 normalize_image_data 解码)。
  const submitItems = useAgentStore((st) => st.submitItems);
  const { currentWorkspace } = useCurrentWorkspace();
  const handleRegenerateTurn = async (turnId: string) => {
    const epoch = sessionEpoch.current.value;
    const target = turns.find((tr) => tr.id === turnId);
    if (!target) return;
    const items = userItemsFromTurn(target);
    if (items === null) return;
    const ok = await confirmDialog({
      title: t('chat.regenerateConfirmTitle'),
      message: t('chat.regenerateConfirmMessage'),
    });
    if (!ok || epoch !== sessionEpoch.current.value ||
        useAgentStore.getState().loadedSessionId !== sessionId) return;
    try {
      await rewind(turnId);
      await submitItems(items, currentWorkspace);
    } catch (e: unknown) {
      pushToast({
        kind: 'error',
        message: t('chat.regenerateFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  // C3 继续生成:引擎无 Continue Op —— 以一条续写指令 UserInput 开新
  // turn(显式近似;上一轮上下文天然在会话历史里,模型可接着写)。
  // 仅在无运行中 turn 时可触发(MessageList 只对末轮露出按钮,这里再守一次)。
  const submit = useAgentStore((st) => st.submit);
  const handleContinueTurn = async () => {
    if (selectIsTurnRunning(useAgentStore.getState())) return;
    try {
      await submit(t('chat.continuePrompt'), currentWorkspace);
    } catch (e: unknown) {
      pushToast({
        kind: 'error',
        message: t('chat.regenerateFailed', { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  };

  useEffect(() => {
    const myId = ++requestIdRef.current;
    // 切换会话:旧会话先降级进后台注册表,再清空主 store —— clearSession
    // 会把「回合未结束、rollout 尚未落盘 assistant 消息」的那段历史与
    // 待审批请求一起抹掉。
    if (useAgentStore.getState().loadedSessionId !== sessionId) {
      demotePreviousSession();
      clearSession();
    }
    if (!sessionId) {
      setLoading(false);
      setError(null);
      return;
    }
    // v1.x:只读查看器态 —— 不 bind 不 replay 主 store。父会话的绑定与
    // 在飞事件完全不受影响;子会话落盘记录由查看器本地回放。等价于
    // 「主区暂借给子会话」,关闭查看器(setActiveId 回父会话)即恢复正常
    // 加载序列。
    if (subTarget) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    // v1.x:先 bind(后端幂等,同 id 短路)再决定 hydrate。bind 保证后端
    // AgentThread 落到本 session id(recorder + LLM 上下文),即使已水合
    // 也必须先走一遍(早退前),Composer 发送才会续写本会话文件。
    // 返回值是该会话恢复出的权限模式 —— 模式绑定会话而非进程,切换
    // 会话后用返回值同步本地徽标/切换器,避免沿用上一会话的显示。
    void zhuye_bind_session(sessionId)
      .then(({ permission_mode, pending_gates }) => {
        if (requestIdRef.current !== myId) return null;
        syncPermissionMode(permission_mode);
        // 会话级提示词预设恢复:读 per-session 覆盖提交 Op::PromptCommand::
        // Select(无记录恢复跟随默认)。Select 不开 turn;该会话内提示词
        // 从此恒定 —— system 指纹稳定是供应商 prompt cache 命中的前提。
        syncSessionPromptSelection(sessionId);
        // v1.12:引擎侧挂起交互快照暂存 —— hydrate 后水合(mergePendingInto
        // 整体替换 pending,先注会丢;hydratePendingGates 按 request_id
        // 去重,两侧同 id 不重复)。
        bindGatesRef.current = pending_gates;
        // 已水合同 id:bind 已完成,不再重复 replay。读 store 实时值而非
        // 闭包快照 —— `loadedSessionId` 不能进 deps(水合成功后会让本
        // effect 重跑第二遍:多余 bind + loading banner 闪断)。
        if (useAgentStore.getState().loadedSessionId === sessionId) return null;
        return zhuye_replay_session(sessionId);
      })
      .then((records: ZhuyeRolloutRecord[] | null) => {
        if (requestIdRef.current !== myId) return;
        if (records) hydrateSession(sessionId, records);
        // v1.x:plan 预设联动 —— 新会话(replay 为空)选了 /plan 预设时把
        // 工作模式校准到 plan,首 turn 免 EnterPlanMode 确认框。必须在
        // replay 之后调:用记录空否判定「新会话」,老会话尊重已持久化的
        // 权限模式。records=null = 已水合的老会话,视作有记录跳过。
        syncPlanPresetPermissionMode(sessionId, records === null || records.length > 0);
        // 用户显式选择的工作模式优先于预设推断：仅新会话（replay 为空）
        // 应用；老会话尊重 rollout 里已持久化的模式。
        syncPreferredPermissionMode(sessionId, records === null || records.length > 0);
        // 思考强度偏好：换绑会用配置默认重置槽位 —— bind 后校准回用户
        // 显式选过的档（无偏好时 no-op，配置默认生效）。
        void syncEffortPreference(sessionId);
        // v1.x 后台持续运行:该会话在后台期间积攒的待确认交互(gate 请求
        // 不落 rollout)合并进主 store,否则会话会静默卡在审批上。
        useBackgroundSessions.getState().mergePendingInto(sessionId);
        // v1.12:引擎侧挂起交互水合(reload 后 pending 不再依赖前端内存
        // 投影;后台 scratch 注回的同 id 挂起态不重复)。
        const gates = bindGatesRef.current;
        bindGatesRef.current = null;
        if (gates?.length) useAgentStore.getState().hydratePendingGates?.(gates);
      })
      .catch((e: unknown) => {
      if (requestIdRef.current !== myId) return;
      setError(commandErrorMsg(e));
    }).finally(() => {
      if (requestIdRef.current !== myId) return;
      setLoading(false);
    });
    return () => {
      // unmount / 换 session 时使在途请求作废,防止旧 replay 水合进
      // 全局 store 污染新会话视图。
      requestIdRef.current++;
    };
  }, [sessionId, hydrateSession, clearSession, syncPermissionMode]);

  const isLoaded = !sessionId || loadedSessionId === sessionId;

  // v2 工作台:轨迹/对话 view-ring + 底部分屏(shellState)。
  // 右栏开合已收敛到 shellUi dock(标题条),此处不再自管一份。
  const [viewMode, setViewMode] = useState<'chat' | 'traj'>('chat');
  const bottomOpen = useZShell((st) => st.bottomOpen);
  const setBottomOpen = useZShell((st) => st.setBottomOpen);
  const gitSum = useGitSummary(Boolean(sessionId));

  // 交互接管:审批 / 问题 / 输入(任一在场即接管 composer 座位)
  const takeoverApproval = useAgentStore((st) => st.pendingApprovals[0] ?? null);
  const takeoverQuestion = useAgentStore((st) => st.pendingQuestions[0] ?? null);
  const takeoverAskUser = useAgentStore((st) => st.pendingAskUser[0] ?? null);
  const goalActive = useAgentStore((st) => st.goalActive);
  const goalText = useAgentStore((st) => st.goalSnapshot?.goal ?? '');
  const turnRunning = useAgentStore((st) => st.turns.some((tn) => tn.status === 'streaming'));
  const sessions = useSessions();

  // 英雄态：无会话（首页）或已加载的空会话（工作区新建 / 刚创建未发言）
  // 都显示徽记 + 问候语 + 快捷模板 chips + 居中 Composer；首条消息发出后
  // turns > 0，同一 Composer 实例自然落回底部常规布局。加载中 / 错误 /
  // 未水合完的会话（isLoaded=false）不进英雄态，避免闪断与错误被吞没。
  const hero = !loading && !error && isLoaded && turns.length === 0;

  // B13：chat + diff 分屏视图。在 Settings → Display 中切换。
  const [prefs] = useUiPrefs();
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  useEffect(() => {
    if (!prefs.chatDiffSplit) {
      setDiffText(null);
      return;
    }
    setDiffLoading(true);
    zhuye_git_diff(false)
      .then((d) => setDiffText(d))
      .catch(() => setDiffText(''))
      .finally(() => setDiffLoading(false));
  }, [prefs.chatDiffSplit]);

  const retry = () => {
    if (!sessionId) return;
  const myId = ++requestIdRef.current;
  setError(null);
  setLoading(true);
  // 与主加载序列同构:bind(幂等)→ replay → hydrate。
  void zhuye_bind_session(sessionId)
    .then(({ permission_mode, pending_gates }) => {
      // 与主路径同源守卫:点 Retry 后立刻切走会话时,
      // 旧会话恢复出的权限模式不得覆盖新会话。
      if (requestIdRef.current !== myId) return null;
      syncPermissionMode(permission_mode);
      bindGatesRef.current = pending_gates;
      return zhuye_replay_session(sessionId);
    })
    .then((r) => {
      if (requestIdRef.current !== myId || !r) return;
      hydrateSession(sessionId, r);
      // 与主路径同源:plan 预设的新会话校准工作模式。
      syncPlanPresetPermissionMode(sessionId, r.length > 0);
      // 与主路径同源：用户显式选择的工作模式优先。
      syncPreferredPermissionMode(sessionId, r.length > 0);
      // 与主路径同源：思考强度偏好校准。
      void syncEffortPreference(sessionId);
      // v1.12:retry 路径同样水合引擎侧挂起交互。
      const gates = bindGatesRef.current;
      bindGatesRef.current = null;
      if (gates?.length) useAgentStore.getState().hydratePendingGates?.(gates);
    }).catch((e: unknown) => {
      if (requestIdRef.current !== myId) return;
      setError(commandErrorMsg(e));
    }).finally(() => {
      if (requestIdRef.current !== myId) return;
      setLoading(false);
    });
  };
  const exportMarkdown = () => {
    if (!sessionId) return;
    void zhuye_export_session_markdown(sessionId)
      .then((result) => pushToast({ kind: 'success', message: t('toast.exportedMarkdown', { path: result?.path ?? '' }) }))
      .catch((error: unknown) => pushToast({ kind: 'error', message: error instanceof Error ? error.message : String(error) }));
  };
  // v1.x:子代理会话只读查看器 —— 早退渲染查看器,不渲染常规 chat 视图
  // (composer 不出现,杜绝向子会话误发消息)。onClose 回父会话(去掉
  // ?sub,恢复正常加载序列)。此时主 store 仍是父会话的投影,横幅下的
  // 消息流全部来自查看器本地 replay。
  if (sessionId && subTarget) {
    const SubagentViewer = slots.SubagentViewer;
    const subTitle = sessions.all.find((s) => s.session_id === subTarget)?.title
      ?? subTarget.slice(0, 8);
    return <SubagentViewer
      parentSessionId={sessionId}
      subId={subTarget}
      title={subTitle}
      onClose={() => setActiveId(sessionId)}
    />;
  }
  return <View
    t={t} sessionId={sessionId}
    title={sessionId ? (sessions.all.find((item) => item.session_id === sessionId)?.title ?? '' ?? sessionId.slice(0, 8)) : t('home.title')}
    loading={loading} error={error} isLoaded={isLoaded} turns={turns} turnCount={turns.length} forking={forking}
    hero={hero} split={prefs.chatDiffSplit} diffLoading={diffLoading} diffText={diffText}
    viewMode={viewMode} onViewModeChange={setViewMode} bottomOpen={bottomOpen} gitSummary={gitSum}
    goalActive={goalActive} goalText={goalText} turnRunning={turnRunning}
    approval={takeoverApproval} question={takeoverQuestion} askUser={takeoverAskUser}
    onFork={handleFork} onRetry={retry} onExport={exportMarkdown}
    onCloseTerminal={() => setBottomOpen(false)}
    onOpenSettings={() => useShellUi.getState().setSettingsOpen(true)}
    onRewind={(id) => { void handleRewind(id); }} onEdit={(id) => { void handleEditTurn(id); }}
    onRegenerate={(id) => { void handleRegenerateTurn(id); }} onContinue={() => { void handleContinueTurn(); }} slots={slots}
  />;
}
