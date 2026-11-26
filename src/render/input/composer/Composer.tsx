import { ArrowUp, Square, ListPlus, CornerDownRight, Lock, LockOpen } from 'lucide-react';
import type { ComposerViewProps } from '@/contracts/conversation/composer';
import { Icon } from '@/render/harness/design-system/Icon';
import { IconButton } from '@/render/harness/design-system/IconButton';
import { Tooltip } from '@/render/harness/design-system/Tooltip';
import s from './Composer.module.css';

/**
 * 输入卡（双层嵌套）：外层 surface 装顶栏胶囊行，内卡装输入区 +
 * 底部工具栏。斜杠命令 / @ 文件引用的显式入口收编在「+」菜单
 * （占位文案教打字触发）；工作模式 / 思考深度等控制收进底栏。
 */
export function Composer({ t, placeholder, text, busy, canSend, sendLabel, sendMode, isTurnRunning, slashVisible,
  slashQuery, slashActiveIdx, mentionVisible, mentionQuery, workspaceLabel, attachments,
  visionBlocked, dragActive, bangRuns, textareaRef, fileInputRef, imageInputRef, onChange, onKeyDown, onPaste,
  onDrop, onDragOver, onPickFile, onPickImage, onSlashActiveChange, onSlashSelect,
  onOpenSlash, onAttachFile, onMention, onPickMention, onCloseMention,
  onRemoveAttachment, onRetryAttachment, onDismissBang, onKillBang, onSendModeChange, onInterrupt,
  onSend, onRunSlash, onFillSlash, onInsertText, onPrefill, sendLocked, onToggleSendLock,
  slots }: ComposerViewProps) {
  const { SlashPopup, MentionPicker, AttachmentBar, BangRunsPanel, ContextUsage, ComposerTopBar, PermissionPicker, PromptPicker, EffortPicker, ComposerPlusMenu, ModelPicker, PlanApprovalBar } = slots;
  const SendIcon = isTurnRunning ? (sendMode === 'steer' ? CornerDownRight : ListPlus) : ArrowUp;
  return (
    <div className={s.wrap}>
      <SlashPopup
        query={slashQuery}
        visible={slashVisible}
        activeIdx={slashActiveIdx}
        onActiveIdxChange={onSlashActiveChange}
        onSelect={onSlashSelect}
      />
      <MentionPicker
        visible={mentionVisible}
        query={mentionQuery}
        workspaceLabel={workspaceLabel}
        onPickFile={onPickMention}
        onClose={onCloseMention}
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

      {/* 外层 surface：顶栏 + 内卡；文件拖拽以整卡为落点。 */}
      <div
        className={s.surface}
        onDrop={onDrop}
        onDragOver={onDragOver}
        data-drag-active={dragActive || undefined}
        data-testid="composer-card"
      >
        {dragActive && (
          <div className={s.dropOverlay} data-testid="composer-drop-overlay">
            {t('composer.drop.hint')}
          </div>
        )}
        {/* 顶栏胶囊行：工作区 / 分支（或 worktree 起点分支）/ 添加 +
            运行位置与 worktree 隔离开关。 */}
        <ComposerTopBar />
        {/* 内卡：抬升面（无边框描边，聚焦底色轻微提亮）。 */}
        <div className={s.card}>
          <BangRunsPanel runs={bangRuns} onDismiss={onDismissBang} onKill={onKillBang} />
          {/* 计划审批条：计划就绪 / 请求进入计划模式时取代全局弹窗，
              正文在右侧 dock 计划页签。 */}
          <PlanApprovalBar />
          {/* 视觉降级警示：模型明确不支持视觉且带图片附件时常驻提示，
              发送时另有确认弹窗（见 useComposerSubmission）。 */}
          {visionBlocked && (
            <div className={s.visionNotice} role="status" data-testid="composer-vision-notice">
              {t('composer.visionNotice')}
            </div>
          )}
          <AttachmentBar
            attachments={attachments}
            onRemove={onRemoveAttachment}
            onRetry={onRetryAttachment}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            disabled={busy}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            aria-label={t('composer.ariaLabel')}
            className={s.textarea}
            autoFocus
          />
          {/* 底部工具栏：左侧「+」与工作模式，右侧用量 / 模型 / 思考
              深度 / 语音 / 发送。 */}
          <div className={s.bottomBar}>
            <div className={s.bottomLeft}>
              <ComposerPlusMenu
                onAttachFile={onAttachFile}
                onRunSlash={onRunSlash}
                onFillSlash={onFillSlash}
                onInsertText={onInsertText}
                onOpenSlash={onOpenSlash}
                onMention={onMention}
                onPrefill={onPrefill}
              />
              <PermissionPicker />
              <span className={s.promptSlot}><PromptPicker /></span>
            </div>
            <div className={s.bottomRight}>
              <ContextUsage />
              <ModelPicker />
              <span className={s.effortSlot}><EffortPicker /></span>
              {isTurnRunning && (
                <>
                  <div className={s.modeSwitch} role="radiogroup" aria-label={t('composer.mode.label')} data-testid="composer-mode-switch">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sendMode === 'queue'}
                      className={s.modeBtn}
                      data-active={sendMode === 'queue' || undefined}
                      onClick={() => onSendModeChange('queue')}
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
                      onClick={() => onSendModeChange('steer')}
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
                      onClick={onInterrupt}
                      data-testid="composer-stop"
                    >
                      <Icon icon={Square} size={12} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
              {/* 发送锁定：锁定时 Enter 只换行、⌘/Ctrl+Enter（或按钮）才发送，
                  防止没打完字误触发出。锁定态高亮。 */}
              <Tooltip label={sendLocked ? t('composer.sendLock.on') : t('composer.sendLock.off')} side="top">
                <IconButton
                  label={sendLocked ? t('composer.sendLock.on') : t('composer.sendLock.off')}
                  size="sm"
                  onClick={onToggleSendLock}
                  className={sendLocked ? s.lockOn : undefined}
                  data-testid="composer-send-lock"
                >
                  <Icon icon={sendLocked ? Lock : LockOpen} size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip label={sendLabel} side="top">
                <IconButton
                  label={sendLabel}
                  variant={canSend ? 'primary' : 'default'}
                  size="md"
                  disabled={!canSend}
                  onClick={onSend}
                  className={s.sendCircle}
                  data-testid="composer-send"
                >
                  <Icon icon={SendIcon} size={isTurnRunning ? 14 : 16} />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
