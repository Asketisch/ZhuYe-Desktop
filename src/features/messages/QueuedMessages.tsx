/**
 * QueuedMessages —— 跟进消息队列（C：Queue vs Steer）的气泡列表。
 *
 * 渲染在 MessageList 的 turns 之后：运行中入队的消息在消息流底部
 * 可见，可编辑文本、移除或立即发送。turn 收尾后由 store.drainQueue
 * 自动逐条发出；等待审批/提问/输入/plan 时暂停排空。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Play, Trash2, Pencil, Check, X } from 'lucide-react';
import { Icon, IconButton } from '@/features/design-system';
import { useAgentStore, selectQueuedForActiveSession } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import s from '@/render/messages/QueuedMessages.module.css';

export function QueuedMessages() {
  const { t } = useI18n();
  // v1.x 后台持续运行:只展示当前前台会话的队列(按入队时盖章的
  // sessionId 过滤;undefined 视作当前会话,兼容既有数据)。
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  const removeQueued = useAgentStore((st) => st.removeQueued);
  const updateQueued = useAgentStore((st) => st.updateQueued);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (queued.length === 0) return null;

  const sendNow = (id: string) => {
    const message = useAgentStore.getState().queuedMessages.find((m) => m.id === id);
    if (!message) return;
    useAgentStore.getState().removeQueued(id);
    // 直接提交（乐观插入 user_text turn，消息流中立即可见）；
    // 若 turn 仍在运行，后端 FIFO 会把它排在当前 turn 之后执行。
    void useAgentStore.getState().submitItems(message.items, message.workspace ?? undefined);
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setDraft(text);
  };

  const commitEdit = () => {
    if (editingId) {
      const trimmed = draft.trim();
      if (trimmed) updateQueued(editingId, trimmed);
    }
    setEditingId(null);
  };

  return (
    <div className={s.wrap} data-testid="queued-messages" aria-label={t('composer.queued.title')}>
      <div className={s.title}>{t('composer.queued.title')}</div>
      {queued.map((message, index) => (
        <div key={message.id} className={s.item} data-testid={`queued-item-${index}`}>
          <span className={s.index}>{index + 1}</span>
          {editingId === message.id ? (
            <div className={s.editArea}>
              <textarea
                className={s.editInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
                aria-label={t('composer.queued.edit')}
              />
              <div className={s.editActions}>
                <IconButton label={t('composer.queued.save')} size="sm" onClick={commitEdit} data-testid="queued-save">
                  <Icon icon={Check} size={13} />
                </IconButton>
                <IconButton
                  label={t('composer.queued.cancel')}
                  size="sm"
                  onClick={() => setEditingId(null)}
                  data-testid="queued-cancel"
                >
                  <Icon icon={X} size={13} />
                </IconButton>
              </div>
            </div>
          ) : (
            <>
              <span className={s.text}>{message.text}</span>
              <div className={s.actions}>
                <IconButton
                  label={t('composer.queued.edit')}
                  size="sm"
                  onClick={() => startEdit(message.id, message.text)}
                  data-testid={`queued-edit-${index}`}
                >
                  <Icon icon={Pencil} size={13} />
                </IconButton>
                <IconButton
                  label={t('composer.queued.sendNow')}
                  size="sm"
                  onClick={() => sendNow(message.id)}
                  data-testid={`queued-send-${index}`}
                >
                  <Icon icon={Play} size={13} />
                </IconButton>
                <IconButton
                  label={t('composer.queued.remove')}
                  size="sm"
                  onClick={() => removeQueued(message.id)}
                  data-testid={`queued-remove-${index}`}
                >
                  <Icon icon={Trash2} size={13} />
                </IconButton>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
