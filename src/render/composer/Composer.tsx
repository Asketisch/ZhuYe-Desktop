import { ArrowUp, SlashSquare, AtSign, Square, ListPlus, CornerDownRight, Mic } from 'lucide-react';
import type { ComposerViewProps } from '@/contracts/composer';
import { Icon } from '../design-system/Icon';
import { IconButton } from '../design-system/IconButton';
import { Tooltip } from '../design-system/Tooltip';
import s from './Composer.module.css';

export function Composer({ t, text, busy, canSend, sendLabel, sendMode, isTurnRunning, slashVisible,
  slashQuery, slashActiveIdx, mentionVisible, mentionQuery, workspaceLabel, attachments,
  visionBlocked, dragActive, bangRuns, textareaRef, fileInputRef, imageInputRef, onChange, onKeyDown, onPaste,
  onDrop, onDragOver, onPickFile, onPickImage, onSlashActiveChange, onSlashSelect,
  onOpenSlash, onAttachFile, onMention, onPickMention, onCloseMention,
  onRemoveAttachment, onRetryAttachment, onDismissBang, onKillBang, onSendModeChange, onInterrupt,
  onSend, onRunSlash, onFillSlash, onInsertText, dictationSupported, dictationListening,
  onToggleDictation, slots }: ComposerViewProps) {
  const { SlashPopup, MentionPicker, AttachmentBar, BangRunsPanel, ContextUsage, ComposerControls, ComposerContextBar, ComposerPlusMenu, ModelPicker } = slots;
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

      <div
        className={s.card}
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
        <BangRunsPanel runs={bangRuns} onDismiss={onDismissBang} onKill={onKillBang} />
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
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.ariaLabel')}
          className={s.textarea}
          autoFocus
        />
        {/* 卡片底栏：左「+」入口与 @ 引用，右模型 / 语音 / 发送（zcode 式）。 */}
        <div className={s.bottomBar}>
          <div className={s.bottomLeft}>
            <ComposerPlusMenu
              onAttachFile={onAttachFile}
              onRunSlash={onRunSlash}
              onFillSlash={onFillSlash}
              onInsertText={onInsertText}
            />
            <Tooltip label={t('composer.toolbar.slashCommands')} side="top">
              <IconButton
                label={t('composer.toolbar.slashCommands')}
                size="sm"
                onClick={onOpenSlash}
              >
                <Icon icon={SlashSquare} size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('composer.toolbar.mentionFile')} side="top">
              <IconButton
                label={t('composer.toolbar.mentionFile')}
                size="sm"
                onClick={onMention}
                data-testid="composer-attach-mention"
              >
                <Icon icon={AtSign} size={14} />
              </IconButton>
            </Tooltip>
          </div>
          <div className={s.bottomRight}>
            <ContextUsage />
            <ModelPicker />
            <Tooltip
              label={dictationSupported ? t('composer.dictation.hint') : t('composer.dictation.unsupported')}
              side="top"
            >
              <IconButton
                label={t('composer.dictation.hint')}
                size="sm"
                onClick={onToggleDictation}
                disabled={!dictationSupported}
                className={dictationListening ? s.dictationOn : undefined}
                data-testid="composer-dictation"
              >
                <Icon icon={Mic} size={14} />
              </IconButton>
            </Tooltip>
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

      {/* 打开的目录 + 运行位置 + git 分支：紧贴输入卡片下方的上下文行。 */}
      <ComposerContextBar />
      {/* 思考深度 / 审批策略 / 权限模式：上下文行下方的控制行。 */}
      <ComposerControls />
    </div>
  );
}
