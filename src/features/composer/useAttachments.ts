/**
 * useAttachments —— Composer 的附件状态管理 (B5)。
 *
 * 模型: 一组 "pending" UserInputItem (本地路径 / inline image / skill mention / 文件 mention)。
 * 在用户点 Send 时,把所有 pending items + 文本组成 `userInput(...)` submission。
 *
 * 状态机(A3):每个附件带 `status` —— 浏览器侧只有字节的文件先以
 * `pending` 入列(useFileIngest 落盘),成功后 settle 为 `ready` 的真实路径
 * file mention,失败标 `error` 可重试。任一非 ready 时发送被禁用。
 *
 * 不直接调 `reflect_*` —— 暴露 `items` + `text` 给 caller 自行组装。
 */
import { useCallback, useState } from 'react';
import type { FileRange, UserInputItem } from '@/types/protocol';

/** 附件的就绪状态:pending=落盘中 / ready=可发送 / error=失败(可重试或删除)。 */
export type AttachmentStatus = 'pending' | 'ready' | 'error';

export type PendingAttachment =
  | { kind: 'local_image'; path: string }
  | { kind: 'image'; data: string; mime_type: string }
  | { kind: 'skill'; name: string }
  | { kind: 'file'; path: string; range?: FileRange }
  | {
      /** 浏览器字节流文件:落盘前 path 只是展示用文件名。 */
      kind: 'browser_file';
      path: string;
      /** 原始字节源,error 重试用;成功后由 updateAttachment 换成 ready 的 file。 */
      source: File;
    };

/** 带 id 与状态的外发附件(useFileIngest 状态机用)。 */
export interface StagedAttachment {
  id: string;
  status: AttachmentStatus;
  attachment: PendingAttachment;
}

export interface UseAttachmentsResult {
  attachments: StagedAttachment[];
  addLocalImage: (path: string) => void;
  addInlineImage: (data: string, mimeType: string) => void;
  addSkillMention: (name: string) => void;
  /** v1.x：把 MentionPicker 选中的文件加入待发列表。 */
  addFileMention: (path: string, range?: FileRange) => void;
  /** A1:浏览器字节流文件入列(pending),由 useFileIngest 异步落盘。 */
  addBrowserFile: (file: File) => string;
  /** A3:按 id 更新附件(落盘成功 settle / 失败标错)。 */
  updateAttachment: (id: string, next: PendingAttachment, status?: AttachmentStatus) => void;
  /** 是否有附件仍在处理中或失败(发送门禁)。 */
  hasBlocking: () => boolean;
  remove: (idx: number) => void;
  removeById: (id: string) => void;
  clear: () => void;
  clearSent: (sent: StagedAttachment[]) => void;
  toUserInputItems: () => UserInputItem[];
}

let attachmentSeq = 0;
const nextAttachmentId = () => `att-${Date.now().toString(36)}-${++attachmentSeq}`;

export function useAttachments(): UseAttachmentsResult {
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);

  const push = useCallback((attachment: PendingAttachment, status: AttachmentStatus = 'ready') => {
    const id = nextAttachmentId();
    setAttachments((prev) => [...prev, { id, status, attachment }]);
    return id;
  }, []);

  const addLocalImage = useCallback((path: string) => {
    push({ kind: 'local_image', path });
  }, [push]);

  const addInlineImage = useCallback((data: string, mimeType: string) => {
    push({ kind: 'image', data, mime_type: mimeType });
  }, [push]);

  const addSkillMention = useCallback((name: string) => {
    push({ kind: 'skill', name });
  }, [push]);

  const addFileMention = useCallback((path: string, range?: FileRange) => {
    push({ kind: 'file', path, range });
  }, [push]);

  const addBrowserFile = useCallback(
    (file: File) => push({ kind: 'browser_file', path: file.name, source: file }, 'pending'),
    [push],
  );

  const updateAttachment = useCallback(
    (id: string, next: PendingAttachment, status: AttachmentStatus = 'ready') => {
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, attachment: next, status } : a)),
      );
    },
    [],
  );

  const hasBlocking = useCallback(
    () => attachments.some((a) => a.status !== 'ready'),
    [attachments],
  );

  const remove = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const removeById = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);
  const clearSent = useCallback((sent: StagedAttachment[]) => {
    const sentSet = new Set(sent);
    setAttachments((current) => current.filter((item) => !sentSet.has(item)));
  }, []);

  const toUserInputItems = useCallback((): UserInputItem[] => {
    return attachments.map(({ attachment: a }): UserInputItem => {
      switch (a.kind) {
        case 'local_image':
          return { type: 'local_image', path: a.path };
        case 'image':
          return { type: 'image', data: a.data, mime_type: a.mime_type };
        case 'skill':
          return { type: 'skill', name: a.name };
        case 'browser_file':
          // 正常流程到不了这里(发送被 pending 门禁挡住);兜底按文件名 mention。
          return { type: 'file', path: a.path };
        case 'file':
          return a.range
            ? { type: 'file', path: a.path, range: a.range }
            : { type: 'file', path: a.path };
      }
    });
  }, [attachments]);

  return {
    attachments,
    addLocalImage,
    addInlineImage,
    addSkillMention,
    addFileMention,
    addBrowserFile,
    updateAttachment,
    hasBlocking,
    remove,
    removeById,
    clear,
    clearSent,
    toUserInputItems,
  };
}
