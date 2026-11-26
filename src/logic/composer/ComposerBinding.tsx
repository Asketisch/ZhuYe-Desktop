import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { ComposerSlots, ComposerViewProps } from '@/contracts/composer';
import { filterSlashCommands } from './slashCommands';
import { usePromptHistory } from './usePromptHistory';
import { useComposerInput } from './useComposerInput';
import { useComposerDraft, emitComposerPrefill } from './useComposerDraft';
import { useComposerSubmission, type SendMode } from './useComposerSubmission';
import { useComposerFileEntries } from './useComposerFileEntries';
import { usePluginCommands } from './usePluginCommands';
import { useBangShell } from './useBangShell';
import { useCurrentWorkspace } from '@/logic/shell/useCurrentWorkspace';
import { useActiveSession } from '@/logic/sessions/useSessions';
import { useModelAbilities } from '@/logic/models/useModelAbilities';
import { useI18n } from '@/utils/i18n';
import { useUiPrefs } from '@/logic/preferences/uiPrefs';
import { useAgentStore, selectIsTurnRunning } from '@/stores/agentStore';

/** 输入、附件和发送状态到渲染组件的绑定。 */
export function ComposerBinding({ view: View, slots }: { view: ComponentType<ComposerViewProps>; slots: ComposerSlots }) {
  const { t } = useI18n();
  // v1.11 桌面#4：锁定发送 —— uiPrefs.sendOnEnter=false 时 Enter 只换行,
  // 发送走 ⌘/Ctrl+Enter / 按钮(防误发)。
  const [uiPrefs, updateUiPrefs] = useUiPrefs();
  const { sendOnEnter } = uiPrefs;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // F：草稿按会话持久化 —— 切会话不丢输入；Hero 快捷模板经 prefill
  // 总线写入草稿后聚焦输入框。
  const { activeId } = useActiveSession();
  const { text, setText, clearSubmittedDraft } = useComposerDraft(activeId, {
    onPrefill: () => requestAnimationFrame(() => textareaRef.current?.focus()),
  });
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  // P3：slash 弹层键盘选中项（受控；列表同源 filterSlashCommands）。
  const [slashActiveIdx, setSlashActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // C：Queue（默认）/ Steer 模式 —— 仅 turn 运行中发送时生效。
  const [sendMode, setSendMode] = useState<SendMode>('queue');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // A1:附件三入口(原生多选 / 粘贴 / 拖拽兜底)聚合 hook,见
  // useComposerFileEntries —— 图片内联、其余落盘转真实路径 file mention。
  const {
    attachments,
    ingest,
    drop,
    onPickImage,
    onAttachFile,
    onPickFile,
    onPaste,
    onDrop,
    onDragOver,
  } = useComposerFileEntries(fileInputRef);
  const history = usePromptHistory('default');
  const { currentWorkspace } = useCurrentWorkspace();
  // P3：`!` 终端直通 —— 本地执行面板（不进 agent 循环、不写会话历史）。
  const bang = useBangShell();
  // 插件 slash 命令:拉取已挂载插件的命令进注册表(弹层候选 + 引擎直通)。
  usePluginCommands();

  const focus = useCallback(() => textareaRef.current?.focus(), []);
  const { send: doSubmit, runSlash } = useComposerSubmission({
    text,
    attachments,
    history,
    setText,
    clearSubmittedDraft,
    setBusy,
    setSlashVisible,
    focus,
    currentWorkspace,
    sendMode,
    onBangCommand: bang.run,
  });
  const { onChange, onKeyDown } = useComposerInput({
    text,
    setText,
    textareaRef,
    sendOnEnter,
    slashVisible,
    setSlashVisible,
    setSlashQuery,
    mentionVisible,
    setMentionVisible,
    setMentionQuery,
    history,
    submit: (options) => void doSubmit(options),
    onSlashNav: (direction) => {
      const count = filterSlashCommands(slashQuery).length;
      if (count === 0) return;
      setSlashActiveIdx((idx) =>
        direction === 'down' ? Math.min(idx + 1, count - 1) : Math.max(idx - 1, 0),
      );
    },
    onSlashPick: () => {
      // 已完整输入某个命令名（如 `/compact`）时放行给提交路径 ——
      // Enter 立即执行，而非仅补全候选（保留旧行为）。字符集含 `:` /
      // 数字 / 下划线,使插件命令全名(`demo:hello`)同样放行。
      const exact = /^\/([a-z0-9:_-]+)$/i.exec(text.trim());
      if (exact && filterSlashCommands('').some((c) => c.name === exact[1])) {
        return false;
      }
      const candidates = filterSlashCommands(slashQuery);
      const picked = candidates[slashActiveIdx];
      if (!picked) return false;
      onSlashSelect(picked.name);
      return true;
    },
  });

  const onSlashSelect = useCallback((command: string) => {
    setText((previous) => {
      // 清除已有的 `/<token>`（含连字符命令名，如 /exit-pl）以及用户
      // 已输入的参数，使点击弹层条目始终产生干净的 `/<command> `。
      // 此前用 `\w*` 会在 `-` 处截断，带连字符的命令永远匹配失败。
      const replaced = previous.replace(/\/\S*(?:\s.*)?$/, `/${command} `);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (element) {
          element.focus();
          element.selectionStart = element.selectionEnd = replaced.length;
        }
      });
      return replaced;
    });
    setSlashVisible(false);
  }, []);

  const onPickMention = useCallback(
    (relPath: string) => {
      // 1. 清除 textarea 末尾的 `@<query>` 片段（保留前导空白）
      setText((prev) => prev.replace(/(^|\s)@[^@\s]*$/, '$1'));
      // 2. 把文件加进 attachments（待发列表）
      attachments.addFileMention(relPath);
      setMentionVisible(false);
      focus();
    },
    [attachments, focus],
  );

  const onMentionButton = useCallback(() => {
    // 工具栏 `@` 按钮：在末尾追加 `@`（必要时补前导空格）并**直接**打开弹层。
    // 直接 setState 不触发 onChange，MENTION_QUERY 不会重算 ——
    // 因此这里显式 setMentionVisible(true)（后续输入会由 onChange 接管）。
    setText((prev) => {
      const needsSpace = prev.length > 0 && !/\s$/.test(prev);
      const next = `${prev}${needsSpace ? ' ' : ''}@`;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = next.length;
        }
      });
      return next;
    });
    setMentionVisible(true);
    setMentionQuery('');
  }, []);

  const workspaceLabel = currentWorkspace
    ? `@ ${currentWorkspace.split('/').filter(Boolean).pop() ?? currentWorkspace}`
    : undefined;

  // P3：查询变化时键盘选中复位到首项（SlashPopup 内部还会做越界夹紧）。
  useEffect(() => {
    setSlashActiveIdx(0);
  }, [slashQuery]);

  // E：turn 运行中提供可见的停止入口（此前只有 /interrupt 斜杠命令）。
  const isTurnRunning = useAgentStore(selectIsTurnRunning);
  const interrupt = useAgentStore((st) => st.interrupt);
  const pushToast = useAgentStore((st) => st.pushToast);
  // v1.10：停止是用户的明确意图 —— IPC/引擎拒绝时不能静默吞掉，
  // 否则表现为「点了没反应」。失败也给出可见反馈。
  const handleInterrupt = useCallback(() => {
    void interrupt().catch((error: unknown) => {
      pushToast({
        kind: 'error',
        message: t('composer.interruptFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    });
  }, [interrupt, pushToast, t]);

  // A3:任一附件还在落盘(pending)或已失败(error)时禁发 —— 对齐
  // 「全部就绪才可发送」,防止把半成品附件集发出去。
  const canSend =
    !busy &&
    !attachments.hasBlocking() &&
    (Boolean(text.trim()) || attachments.attachments.length > 0);

  // 视觉降级警示:当前模型**明确**不支持视觉且附件里有图片 → 输入卡内
  // 常驻提示(发送时另有确认弹窗,见 useComposerSubmission)。
  // `supports_vision === null`(目录没说)不警示也不拦截 —— 未知不是否定。
  const currentSpec = useAgentStore((st) => st.prompt?.currentSpec ?? '');
  const abilities = useModelAbilities(currentSpec);
  const visionBlocked =
    abilities.data?.supports_vision === false &&
    attachments.attachments.some(
      (a) => a.attachment.kind === 'image' || a.attachment.kind === 'local_image',
    );
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  // v1.11 桌面#4:锁定发送时提示键位改为 ⌘/Ctrl+Enter(与实际行为一致)。
  const sendHint = !sendOnEnter
    ? t('composer.sendHintLocked')
    : isMac
      ? t('composer.sendHintMac')
      : t('composer.sendHintOther');

  // C：运行中发送按钮按模式变化（Queue → 入队 / Steer → 转向）。
  const sendLabel = isTurnRunning
    ? sendMode === 'steer'
      ? t('composer.mode.steerHint')
      : t('composer.mode.queueHint')
    : sendHint;

  // placeholder 三态：运行中排队 / 追问 / 新会话引导（新会话文案顺带
  // 教 @ 与 / 的打字触发 —— 独立图标按钮已收编进「+」菜单）。
  // 计划挂起时覆盖为审批语境：输入文字发送 = 打回修订并注入反馈。
  const turnsCount = useAgentStore((st) => st.turns.length);
  const pendingPlan = useAgentStore((st) => st.pendingPlan);
  const placeholder = pendingPlan
    ? t(pendingPlan.kind === 'request'
      ? 'composer.placeholder.planRequest'
      : 'composer.placeholder.planFeedback')
    : isTurnRunning
      ? t('composer.placeholder.queue')
      : turnsCount > 0
        ? t('composer.placeholder.followUp')
        : t('composer.placeholder.newTask');

  return <View
    t={t} placeholder={placeholder} text={text} busy={busy} canSend={canSend} sendLabel={sendLabel} sendMode={sendMode}
    isTurnRunning={isTurnRunning} slashVisible={slashVisible} slashQuery={slashQuery}
    slashActiveIdx={slashActiveIdx} mentionVisible={mentionVisible} mentionQuery={mentionQuery}
    workspaceLabel={workspaceLabel}
    attachments={attachments.attachments} visionBlocked={visionBlocked} dragActive={drop.dragActive} bangRuns={bang.runs}
    textareaRef={textareaRef} fileInputRef={fileInputRef} imageInputRef={imageInputRef}
    onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} onDrop={onDrop} onDragOver={onDragOver}
    onPickFile={onPickFile} onPickImage={onPickImage} onSlashActiveChange={setSlashActiveIdx} onSlashSelect={onSlashSelect}
    onOpenSlash={() => { setText((value) => value.startsWith('/') ? value : `/${value}`); focus(); }}
    onAttachFile={onAttachFile}
    onMention={onMentionButton} onPickMention={onPickMention} onCloseMention={() => setMentionVisible(false)}
    onRemoveAttachment={attachments.remove} onRetryAttachment={ingest.retry}
    onDismissBang={bang.dismiss} onKillBang={(id) => { void bang.kill(id); }}
    onSendModeChange={setSendMode} onInterrupt={handleInterrupt} onSend={() => { void doSubmit(); }}
    onRunSlash={(command) => { void runSlash(command); }}
    onFillSlash={(command) => {
      // plan/goal 这类模式指令天然是消息前缀 —— 已有文本时插到最前
      // (`/plan 为官网做规划`),追加到末尾会语义倒挂(`/plan` 甩在
      // 任务描述后面,引擎解析不到档位参数)。空输入维持 `/<cmd> `。
      setText((previous) => {
        const tag = `/${command} `;
        if (!previous.trim()) return tag;
        return `${tag}${previous.trimStart()}`;
      });
      focus();
    }}
    onInsertText={(value) => {
      setText((previous) => `${previous}${previous && !/\s$/.test(previous) ? ' ' : ''}${value}`);
      focus();
    }}
    // 「+」菜单「建议」二级目录:预填任务模板(不自动发送)。
    // 走 `emitComposerPrefill` 总线而非直接 setText —— 与原首页快捷模板
    // 同一条路径,草稿持久化与聚焦行为保持一致。
    onPrefill={(text) => { emitComposerPrefill(text); }}
    sendLocked={!sendOnEnter}
    onToggleSendLock={() => updateUiPrefs({ sendOnEnter: !sendOnEnter })}
    slots={slots}
  />;
}
