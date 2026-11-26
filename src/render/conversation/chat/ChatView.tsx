import { MessageSquare, GitBranch } from 'lucide-react';
import type { ChatViewProps } from '@/contracts/conversation/chat';
import { Button } from '@/render/harness/design-system/Button';
import { Icon } from '@/render/harness/design-system/Icon';
import { Spinner } from '@/render/harness/design-system/Spinner';
import s from './ChatView.module.css';

export function ChatView({ t, sessionId, title, loading, error, isLoaded, turnCount, forking, hero,
  split, diffLoading, diffText, viewMode, onViewModeChange, bottomOpen, gitSummary,
  goalActive, goalText, turnRunning, approval, question, askUser, onFork, onRetry, onExport,
  onCloseTerminal, onOpenSettings, onRewind,
  onEdit, onRegenerate, onContinue, slots }: ChatViewProps) {
  const { WorkHead, ViewRing, MessageList, Composer, ChatHero, ContextBanner,
    TrajView, SessionDock, SessionCapsule, ApprovalTakeover, QuestionTakeover, AskUserTakeover,
    BottomTabs, DiffViewer } = slots;
  const takeover = approval ?? question ?? askUser;
  return (
    <div className={s.zroot} data-split={split ? 'on' : 'off'} data-hero={hero ? 'on' : 'off'}>
      <WorkHead
        title={title} gitSum={gitSummary} onFork={() => onFork('manual')} onExportMarkdown={onExport}
        onOpenSettings={onOpenSettings}
      />
      <ViewRing mode={viewMode} onChange={onViewModeChange} />
      {viewMode === 'traj' ? (
        <TrajView />
      ) : (
      <div className={s.chatpane} data-testid="session-chatpane">
      <div className={s.chatMain}>
      {sessionId && loading && (
        <div className={s.sessionBanner} role="status" aria-live="polite">
          <Spinner size={14} />
          <span>{t('chat.loading')}</span>
        </div>
      )}
      {sessionId && error && (
        <div className={s.sessionBanner} role="alert">
          <span>{t('chat.loadErrorWithMsg', { msg: error })}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
          >
            {t('chat.retry')}
          </Button>
        </div>
      )}
      {/* 英雄态已含徽记问候 + 居中 Composer，空会话横幅让位避免重复提示。 */}
      {!hero && sessionId && isLoaded && !loading && !error && turnCount === 0 && (
        <div className={s.sessionBanner} role="status">{t('chat.emptySession')}</div>
      )}
      {sessionId && isLoaded && turnCount > 0 && (
        <div className={s.sessionBanner} role="status">
          <Icon icon={MessageSquare} size={12} />
          <span>{t('chat.viewing')} <code className={s.sessionId}>{sessionId}</code>.</span>
          <button
            type="button"
            className={s.forkBtn}
            onClick={() => onFork('manual')}
            disabled={forking}
            title={t('threads.forkHint')}
            data-testid="chat-fork"
          >
            <Icon icon={GitBranch} size={12} />
            {t('threads.fork')}
          </button>
        </div>
      )}
      {hero && <ChatHero />}
      {!hero && <ContextBanner />}
      {!loading && !error && (
        // 英雄态仅视觉隐藏（display:none），保持 MessageList 挂载 ——
        // 其 role="log" 区与滚动锚点被集成测试和自动滚动消费。
        <div className={s.chatArea} data-hero={hero ? 'on' : 'off'} data-testid="chat-messages-area">
          <MessageList
            onForkTurn={(turnId, branch) => onFork(branch, turnId)}
            onRewindTurn={(turnId) => onRewind(turnId)}
            onEditTurn={(turnId) => onEdit(turnId)}
            onRegenerateTurn={(turnId) => onRegenerate(turnId)}
            onContinueTurn={() => onContinue()}
          />
        </div>
      )}
      {!loading && !error && <SessionDock goalActive={goalActive} goalText={goalText} turnRunning={turnRunning} />}
      {!loading && !error && approval && <ApprovalTakeover approval={approval} />}
      {!loading && !error && question && <QuestionTakeover question={question} />}
      {!loading && !error && askUser && <AskUserTakeover askUser={askUser} />}
      {!loading && !error && <SessionCapsule goalActive={goalActive} turnRunning={turnRunning} />}
      {!loading && !error && !takeover && <Composer />}
      </div>
      </div>
      )}
      <BottomTabs open={bottomOpen} onClose={onCloseTerminal} />
      {split && !hero && (
        <aside className={s.diffPanel} aria-label={t('chat.diffPanel')}>
          <header className={s.diffHeader}>
            <Icon icon={GitBranch} size={14} />
            <span>{t('chat.diffHeader')}</span>
          </header>
          <div className={s.diffPre}>
            <DiffViewer
              diff={diffLoading ? '' : (diffText ?? '')}
              emptyMessage={diffLoading ? t('chat.diffLoading') : t('chat.diffEmpty')}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
