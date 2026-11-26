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
 * 不直接调 `zhuye_*` —— 暴露 `items` + `text` 给 caller 自行组装。
 */
import { useCallback, useState } from 'react';
import type { FileRange, UserInputItem } from '@/types/protocol';
import { buildImageMarker } from '@/stores/agent/imageProvenance';
import type { ImageProvenance } from '@/stores/agent/imageProvenance';
import { useI18n } from '@/utils/i18n';

/** 附件的就绪状态:pending=落盘中 / ready=可发送 / error=失败(可重试或删除)。 */
export type AttachmentStatus = 'pending' | 'ready' | 'error';

export type PendingAttachment =
  | { kind: 'local_image'; path: string }
  | { kind: 'image'; data: string; mime_type: string; /** 来源通道,发送时展开为出处标记(见 imageProvenance)。 */ source: ImageProvenance }
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
  addInlineImage: (data: string, mimeType: string, source: ImageProvenance) => void;
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
  /**
   * 组装待发 items。`excludeImages` = 视觉降级剥离:图片 / 本地图片附件
   * 连同其来源标记一起跳过(标记与图片同生同灭,不留孤儿文本)。
   */
  toUserInputItems: (opts?: { excludeImages?: boolean }) => UserInputItem[];
}

let attachmentSeq = 0;
const nextAttachmentId = () => `att-${Date.now().toString(36)}-${++attachmentSeq}`;

export function useAttachments(): UseAttachmentsResult {
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const { t } = useI18n();

  const push = useCallback((attachment: PendingAttachment, status: AttachmentStatus = 'ready') => {
    const id = nextAttachmentId();
    setAttachments((prev) => [...prev, { id, status, attachment }]);
    return id;
  }, []);

  const addLocalImage = useCallback((path: string) => {
    push({ kind: 'local_image', path });
  }, [push]);

  const addInlineImage = useCallback((data: string, mimeType: string, source: ImageProvenance) => {
    push({ kind: 'image', data, mime_type: mimeType, source });
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

  const toUserInputItems = useCallback(
    (opts?: { excludeImages?: boolean }): UserInputItem[] => {
      const excludeImages = opts?.excludeImages ?? false;
      const out: UserInputItem[] = [];
      let imageSeq = 0;
      for (const { attachment: a } of attachments) {
        // 视觉降级剥离:图片类附件(及其来源标记)一并跳过。
        if (excludeImages && (a.kind === 'image' || a.kind === 'local_image')) continue;
        switch (a.kind) {
          case 'local_image':
            // 遗留 kind:引擎只按路径读字节,模型看不到路径 —— 同样注入出处标记。
            out.push({ type: 'text', text: buildImageMarker({ channel: 'file', path: a.path }, ++imageSeq, t) });
            out.push({ type: 'local_image', path: a.path });
            break;
          case 'image':
            // 出处标记紧贴图片 item(独立文本块),模型不再反推图片来源;
            // 回放侧按 imageProvenance.IMAGE_MARKER_RE 还原,不渲染为正文。
            out.push({ type: 'text', text: buildImageMarker(a.source, ++imageSeq, t) });
            out.push({ type: 'image', data: a.data, mime_type: a.mime_type });
            break;
          case 'skill':
            out.push({ type: 'skill', name: a.name });
            break;
          case 'browser_file':
            // 正常流程到不了这里(发送被 pending 门禁挡住);兜底按文件名 mention。
            out.push({ type: 'file', path: a.path });
            break;
          case 'file':
            out.push(
              a.range
                ? { type: 'file', path: a.path, range: a.range }
                : { type: 'file', path: a.path },
            );
            break;
        }
      }
      return out;
    },
    [attachments, t],
  );

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
