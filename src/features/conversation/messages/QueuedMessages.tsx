/**
 * QueuedMessages —— 跟进消息队列（C：Queue vs Steer）。
 *
 * 渲染在 MessageList 的 turns 之后：运行中入队的消息在消息流底部可见。
 * turn 收尾后由 store.drainQueue 自动逐条发出；等待审批/提问/输入/plan
 * 时暂停排空。
 *
 * v1.13 起行形态对齐 ZCode：
 *   [⠿ 拖拽柄] 正文（附件名在下一行、弱化色）   [↑ 立即] [✎] [🗑]
 * 并支持**拖拽调整顺序**（HTML5 DnD；顺序即 drainQueue 的发送顺序）。
 *
 * 同一个 `QueueList` 也被会话内 chips 的「排队」弹层复用 —— 两处不再各
 * 维护一套行 UI。
 */
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUp, Trash2, Pencil, Check, X, GripVertical } from 'lucide-react';
import { Icon, IconButton } from '@/features/harness/design-system';
import { useAgentStore, selectQueuedForActiveSession } from '@/stores/agentStore';
import type { QueuedMessage } from '@/stores/agent/types';
import { useI18n } from '@/utils/i18n';
import s from '@/render/messages/QueuedMessages.module.css';

/** 入队项里的附件展示名（图片 / 本地图片 / 文件引用）。 */
function attachmentNames(items: QueuedMessage['items']): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.type === 'local_image' || item.type === 'file') {
      const name = item.path.split('/').filter(Boolean).pop();
      if (name) out.push(name);
    } else if (item.type === 'image') {
      out.push(item.mime_type || 'image');
    }
  }
  return out;
}

/** 行列表本体（消息流面板与会话内弹层共用）。 */
export function QueueList({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  const removeQueued = useAgentStore((st) => st.removeQueued);
  const updateQueued = useAgentStore((st) => st.updateQueued);
  const reorderQueued = useAgentStore((st) => st.reorderQueued);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** 正在拖拽的条目 id。 */
  const [dragId, setDragId] = useState<string | null>(null);
  /** 拖到哪一行上（画插入指示线）。 */
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // ref 镜像：dragover 高频触发，用 ref 判断「这次拖动是否由本列表发起」，
  // 避免每帧读 state 造成的闭包时序问题。
  const dragIdRef = useRef<string | null>(null);

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

  const endDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <ul className={compact ? `${s.list} ${s.listCompact}` : s.list} data-testid="queued-list">
      {queued.map((message, index) => {
        const editing = editingId === message.id;
        const names = attachmentNames(message.items);
        const dragging = dragId === message.id;
        return (
          <li
            key={message.id}
            className={s.row}
            data-testid={`queued-item-${index}`}
            data-dragging={dragging || undefined}
            data-drop-target={(overIndex === index && dragId !== null && !dragging) || undefined}
            draggable={!editing}
            onDragStart={(event) => {
              dragIdRef.current = message.id;
              setDragId(message.id);
              event.dataTransfer.effectAllowed = 'move';
              // 部分浏览器（WebKit）不设置 data 就不触发 drop。
              event.dataTransfer.setData('text/plain', message.id);
            }}
            onDragOver={(event) => {
              if (!dragIdRef.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const fromId = dragIdRef.current;
              if (fromId) reorderQueued(fromId, index);
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <span className={s.handle} title={t('composer.queued.dragHint')} aria-hidden="true">
              <Icon icon={GripVertical} size={14} />
            </span>

            <div className={s.body}>
              {editing ? (
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
                  {names.length > 0 && (
                    <span className={s.atts} title={names.join(', ')}>
                      {names.join(' · ')}
                    </span>
                  )}
                </>
              )}
            </div>

            {!editing && (
              <div className={s.actions}>
                <button
                  type="button"
                  className={s.sendBtn}
                  onClick={() => sendNow(message.id)}
                  title={t('composer.queued.sendNow')}
                  data-testid={`queued-send-${index}`}
                >
                  <Icon icon={ArrowUp} size={13} />
                  <span>{t('composer.queued.sendNow')}</span>
                </button>
                <IconButton
                  label={t('composer.queued.edit')}
                  size="sm"
                  onClick={() => startEdit(message.id, message.text)}
                  data-testid={`queued-edit-${index}`}
                >
                  <Icon icon={Pencil} size={13} />
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
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 消息流底部的队列面板（标题 + 行列表）。 */
export function QueuedMessages() {
  const { t } = useI18n();
  const queued = useAgentStore(useShallow(selectQueuedForActiveSession));
  if (queued.length === 0) return null;
  return (
    <div className={s.wrap} data-testid="queued-messages" aria-label={t('composer.queued.title')}>
      <div className={s.title}>{t('composer.queued.title')}</div>
      <QueueList />
    </div>
  );
}
