import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  SlashSquare,
  Image as ImageIcon,
  FileText,
  AtSign,
  Square,
  ListPlus,
  CornerDownRight,
} from 'lucide-react';
import { Icon, IconButton, Tooltip } from '@/features/design-system';
import { SlashPopup } from './SlashPopup';
import { TIER_A_TOOLBAR, filterSlashCommands } from './slashCommands';
import { AttachmentBar } from './AttachmentBar';
import { MentionPicker } from './MentionPicker';
import { usePromptHistory } from './usePromptHistory';
import { useComposerInput } from './useComposerInput';
import { useComposerDraft } from './useComposerDraft';
import { useComposerSubmission, type SendMode } from './useComposerSubmission';
import { useComposerFileEntries } from './useComposerFileEntries';
import { usePluginCommands } from './usePluginCommands';
import { ContextUsage } from './ContextUsage';
import { ComposerControls } from './ComposerControls';
import { ComposerContextBar } from './ComposerContextBar';
import { useBangShell } from './useBangShell';
import { BangRunsPanel } from './BangRunsPanel';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { useActiveSession } from '@/features/sessions/hooks/useSessions';
import { useI18n } from '@/utils/i18n';
import { useUiPrefs } from '@/utils/uiPrefs';
import { useAgentStore, selectIsTurnRunning } from '@/stores/agentStore';
import s from './Composer.module.css';

export function Composer() {
  const { t } = useI18n();
  // v1.11 桌面#4：锁定发送 —— uiPrefs.sendOnEnter=false 时 Enter 只换行,
  // 发送走 ⌘/Ctrl+Enter / 按钮(防误发)。
  const { sendOnEnter } = useUiPrefs()[0];
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
  const doSubmit = useComposerSubmission({
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
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  // v1.11 桌面#4:锁定发送时提示键位改为 ⌘/Ctrl+Enter(与实际行为一致)。
  const sendHint = !sendOnEnter
    ? t('composer.sendHintLocked')
    : isMac
      ? t('composer.sendHintMac')
      : t('composer.sendHintOther');

  // C：运行中发送按钮按模式变化（Queue → 入队 / Steer → 转向）。
  const SendIcon = isTurnRunning ? (sendMode === 'steer' ? CornerDownRight : ListPlus) : ArrowUp;
  const sendLabel = isTurnRunning
    ? sendMode === 'steer'
      ? t('composer.mode.steerHint')
      : t('composer.mode.queueHint')
    : sendHint;

  return (
    <div className={s.wrap}>
      <SlashPopup
        query={slashQuery}
        visible={slashVisible}
        activeIdx={slashActiveIdx}
        onActiveIdxChange={setSlashActiveIdx}
        onSelect={onSlashSelect}
      />
      <MentionPicker
        visible={mentionVisible}
        query={mentionQuery}
        workspaceLabel={workspaceLabel}
        onPickFile={onPickMention}
        onClose={() => setMentionVisible(false)}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        data-testid="composer-file-input"
        onChange={(event) => onPickFile(event.target.files)}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="composer-image-input"
        onChange={(event) => onPickImage(event.target.files)}
      />

      <div className={s.toolbar}>
        {TIER_A_TOOLBAR.map((command) => (
          <button
            key={command.name}
            type="button"
            onClick={() => {
              setText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}/${command.name} `);
              setSlashVisible(false);
              focus();
            }}
            title={t(command.summaryKey as Parameters<typeof t>[0])}
            className={s.toolBtn}
          >
            /{command.name}
          </button>
        ))}
      </div>

      <div
        className={s.card}
        onDrop={onDrop}
        onDragOver={onDragOver}
        data-drag-active={drop.dragActive || undefined}
        data-testid="composer-card"
      >
        {drop.dragActive && (
          <div className={s.dropOverlay} data-testid="composer-drop-overlay">
            {t('composer.drop.hint')}
          </div>
        )}
        <BangRunsPanel runs={bang.runs} onDismiss={bang.dismiss} onKill={(id) => void bang.kill(id)} />
        <AttachmentBar
          attachments={attachments.attachments}
          onRemove={attachments.remove}
          onRetry={ingest.retry}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={busy}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.ariaLabel')}
          className={s.textarea}
          autoFocus
        />
        <div className={s.bottomBar}>
          <div className={s.bottomLeft}>
            <Tooltip label={t('composer.toolbar.slashCommands')} side="top">
              <IconButton
                label={t('composer.toolbar.slashCommands')}
                size="sm"
                onClick={() => {
                  setText((value) => (value.startsWith('/') ? value : `/${value}`));
                  focus();
                }}
              >
                <Icon icon={SlashSquare} size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('composer.toolbar.attachFile')} side="top">
              <IconButton
                label={t('composer.toolbar.attachFile')}
                size="sm"
                onClick={onAttachFile}
                data-testid="composer-attach-file"
              >
                <Icon icon={FileText} size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('composer.toolbar.attachImage')} side="top">
              <IconButton
                label={t('composer.toolbar.attachImage')}
                size="sm"
                onClick={() => imageInputRef.current?.click()}
                data-testid="composer-attach-image"
              >
                <Icon icon={ImageIcon} size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('composer.toolbar.mentionFile')} side="top">
              <IconButton
                label={t('composer.toolbar.mentionFile')}
                size="sm"
                onClick={onMentionButton}
                data-testid="composer-attach-mention"
              >
                <Icon icon={AtSign} size={14} />
              </IconButton>
            </Tooltip>
          </div>
          <div className={s.bottomRight}>
            <ContextUsage />
            {isTurnRunning && (
              <>
                <div className={s.modeSwitch} role="radiogroup" aria-label={t('composer.mode.label')} data-testid="composer-mode-switch">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={sendMode === 'queue'}
                    className={s.modeBtn}
                    data-active={sendMode === 'queue' || undefined}
                    onClick={() => setSendMode('queue')}
                    title={t('composer.mode.queueHint')}
                  >
                    {t('composer.mode.queue')}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={sendMode === 'steer'}
                    className={s.modeBtn}
                    data-active={sendMode === 'steer' || undefined}
                    onClick={() => setSendMode('steer')}
                    title={t('composer.mode.steerHint')}
                  >
                    {t('composer.mode.steer')}
                  </button>
                </div>
                <Tooltip label={t('composer.stopHint')} side="top">
                  <IconButton
                    label={t('composer.stop')}
                    variant="default"
                    size="md"
                    onClick={handleInterrupt}
                    data-testid="composer-stop"
                  >
                    <Icon icon={Square} size={12} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <Tooltip label={sendLabel} side="top">
              <IconButton
                label={sendLabel}
                variant={canSend ? 'primary' : 'default'}
                size="md"
                disabled={!canSend}
                onClick={() => void doSubmit()}
                data-testid="composer-send"
              >
                <Icon icon={SendIcon} size={isTurnRunning ? 14 : 16} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 模型 / 思考深度 / 权限模式：输入卡片下方的独立控制条。 */}
      <ComposerControls />
      {/* 打开的目录 + git 分支：对话框侧上下文（自 StatusBar 移入）。 */}
      <ComposerContextBar />
    </div>
  );
}
