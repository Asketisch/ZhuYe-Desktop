/**
 * useAttachments —— Composer 的附件状态管理 (B5)。
 *
 * 模型: 一组 "pending" UserInputItem (本地路径 / inline image / skill mention / 文件 mention)。
 * 在用户点 Send 时,把所有 pending items + 文本组成 `userInput(...)` submission。
 *
 * 不直接调 `reflect_*` —— 暴露 `items` + `text` 给 caller 自行组装。
 */
import { useCallback, useState } from 'react';
import type { FileRange, UserInputItem } from '@/types/protocol';

export type PendingAttachment =
  | { kind: 'local_image'; path: string }
  | { kind: 'image'; data: string; mime_type: string }
  | { kind: 'skill'; name: string }
  | { kind: 'file'; path: string; range?: FileRange };

export interface UseAttachmentsResult {
  attachments: PendingAttachment[];
  addLocalImage: (path: string) => void;
  addInlineImage: (data: string, mimeType: string) => void;
  addSkillMention: (name: string) => void;
  /** v1.x：把 MentionPicker 选中的文件加入待发列表。 */
  addFileMention: (path: string, range?: FileRange) => void;
  remove: (idx: number) => void;
  clear: () => void;
  clearSent: (sent: PendingAttachment[]) => void;
  toUserInputItems: () => UserInputItem[];
}

export function useAttachments(): UseAttachmentsResult {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const addLocalImage = useCallback((path: string) => {
    setAttachments((prev) => [...prev, { kind: 'local_image', path }]);
  }, []);

  const addInlineImage = useCallback((data: string, mimeType: string) => {
    setAttachments((prev) => [...prev, { kind: 'image', data, mime_type: mimeType }]);
  }, []);

  const addSkillMention = useCallback((name: string) => {
    setAttachments((prev) => [...prev, { kind: 'skill', name }]);
  }, []);

  const addFileMention = useCallback((path: string, range?: FileRange) => {
    setAttachments((prev) => [...prev, { kind: 'file', path, range }]);
  }, []);

  const remove = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);
  const clearSent = useCallback((sent: PendingAttachment[]) => {
    const sentSet = new Set(sent);
    setAttachments((current) => current.filter((item) => !sentSet.has(item)));
  }, []);

  const toUserInputItems = useCallback((): UserInputItem[] => {
    return attachments.map((a): UserInputItem => {
      switch (a.kind) {
        case 'local_image':
          return { type: 'local_image', path: a.path };
        case 'image':
          return { type: 'image', data: a.data, mime_type: a.mime_type };
        case 'skill':
          return { type: 'skill', name: a.name };
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
    remove,
    clear,
    clearSent,
    toUserInputItems,
  };
}
