/**
 * useFileIngest —— 浏览器字节流文件的「落盘 → file mention」管线 (A1)。
 *
 * webview 侧 `<input type=file>` / clipboardData / DOM drop 只给字节不给
 * 路径,而引擎 `UserInputItem::File` 与 `/read` 都按路径消费 —— 因此把
 * 字节经 `zhuye_ingest_upload` 落到工作区 `.zhuye/uploads/` 拿到真实
 * 路径,再转成 ready 的 file mention(与 Finder 原生拖拽同款终点)。
 *
 * 状态机(A3):先 `addBrowserFile` 以 pending 入列,成功 settle / 失败
 * 标 error(chip 上可重试/删除);任一非 ready 时 Composer 禁发。
 *
 * 图片不走这里(多模态内容,保持 base64 内联,见 Composer.onPickImage)。
 */
import { useCallback } from 'react';
import { zhuye_ingest_upload } from '@/utils/commands/files';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import type { UseAttachmentsResult } from '@/logic/input/composer/useAttachments';

/** 单文件上限,与后端 `INGEST_MAX` 对齐(64 MiB)。 */
export const INGEST_MAX_BYTES = 64 * 1024 * 1024;

/** File → 裸 base64(不带 data-URL 前缀)。 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('unexpected read result'));
        return;
      }
      // readAsDataURL 产出 `data:<mime>;base64,<payload>`,取最后一段。
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export interface UseFileIngestResult {
  /** 把浏览器字节流文件落盘为工作区内 file mention(pending → ready/error)。 */
  ingestFiles: (files: File[]) => void;
  /** 重试一个失败的附件(按 id,原始 File 保留在 staged 里)。 */
  retry: (id: string) => void;
}

export function useFileIngest(attachments: UseAttachmentsResult): UseFileIngestResult {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);

  // 单个附件的落盘流程:pending → zhuye_ingest_upload → settle/markError。
  const runIngest = useCallback(
    async (id: string, file: File) => {
      try {
        if (file.size > INGEST_MAX_BYTES) {
          throw new Error(t('composer.upload.tooLarge', { size: INGEST_MAX_BYTES }));
        }
        const base64 = await fileToBase64(file);
        const res = await zhuye_ingest_upload(file.name, base64);
        attachments.updateAttachment(id, { kind: 'file', path: res.path });
      } catch (e) {
        attachments.updateAttachment(
          id,
          { kind: 'browser_file', path: file.name, source: file },
          'error',
        );
        pushToast({
          kind: 'error',
          message: t('composer.upload.failed', {
            name: file.name,
            msg: e instanceof Error ? e.message : String(e),
          }),
        });
      }
    },
    [attachments, pushToast, t],
  );

  const ingestFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = attachments.addBrowserFile(file);
        void runIngest(id, file);
      }
    },
    [attachments, runIngest],
  );

  const retry = useCallback(
    (id: string) => {
      const staged = attachments.attachments.find((a) => a.id === id);
      if (staged?.status !== 'error' || staged.attachment.kind !== 'browser_file') return;
      attachments.updateAttachment(
        id,
        { kind: 'browser_file', path: staged.attachment.path, source: staged.attachment.source },
        'pending',
      );
      void runIngest(id, staged.attachment.source);
    },
    [attachments, runIngest],
  );

  return { ingestFiles, retry };
}
