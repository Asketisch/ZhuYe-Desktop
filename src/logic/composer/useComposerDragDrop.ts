/**
 * useComposerDragDrop —— Composer 的原生文件拖拽接入。
 *
 * macOS WKWebView 下 Finder 拖入的文件不会出现在 DOM `dataTransfer.files`
 * （只有 Tauri 原生 `onDragDropEvent` 给路径），故 DOM drop 仅作浏览器/
 * 测试环境兜底（见 Composer.tsx）。本 hook:
 *
 * - 订阅 webview 拖拽事件,暴露 `dragActive` 高亮态 + `nativeDrop` 标记
 *   （true 时 Composer 抑制 DOM drop,防止 Windows 双通道重复添加）;
 * - `ingestPaths` 按扩展名分流:图片 → `reflect_read_image_base64` 读
 *   字节转 data-URL 走 inline image 附件（core 的 LocalImage item 尚未
 *   接通,必须以字节提交）;其余文件 → file mention（真实路径,由 agent
 *   的 /read 按需读取）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { reflect_read_image_base64 } from '@/utils/commands/files';
import { onWebviewDragDrop } from '@/utils/dragDrop';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import type { UseAttachmentsResult } from './useAttachments';

const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

export interface ComposerDragDrop {
  /** 有文件悬停在窗口上（卡片高亮）。 */
  dragActive: boolean;
  /** 原生拖拽事件已订阅（Tauri 环境）—— true 时抑制 DOM drop 兜底。 */
  nativeDrop: boolean;
  /** 把拖入的绝对路径转成附件。 */
  ingestPaths: (paths: string[]) => Promise<void>;
}

export function useComposerDragDrop(attachments: UseAttachmentsResult): ComposerDragDrop {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [dragActive, setDragActive] = useState(false);
  const [nativeDrop, setNativeDrop] = useState(false);
  // 已处理 drop 的单调时间戳 —— 事件重放/双通道时 500ms 内去重。
  const lastDropAt = useRef(0);

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      const now = Date.now();
      if (now - lastDropAt.current < 500) return;
      lastDropAt.current = now;
      for (const p of paths) {
        if (!isImagePath(p)) {
          attachments.addFileMention(p);
          continue;
        }
        try {
          const res = await reflect_read_image_base64(p);
          // 非 Tauri 环境 invoke 降级返回 undefined —— 无字节可加,跳过。
          if (!res) continue;
          attachments.addInlineImage(
            `data:${res.mime_type};base64,${res.base64}`,
            res.mime_type,
          );
        } catch (e) {
          pushToast({
            kind: 'error',
            message: t('composer.drop.imageFailed', {
              msg: e instanceof Error ? e.message : String(e),
            }),
          });
        }
      }
    },
    [attachments, pushToast, t],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onWebviewDragDrop({
      onOver: () => setDragActive(true),
      onLeave: () => setDragActive(false),
      onDrop: (paths) => {
        setDragActive(false);
        void ingestPaths(paths);
      },
    }).then((un) => {
      // 非 Tauri 环境降级返回 null —— 保持 DOM drop 兜底可用。
      if (un == null) return;
      if (disposed) {
        un();
        return;
      }
      unlisten = un;
      setNativeDrop(true);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ingestPaths]);

  return { dragActive, nativeDrop, ingestPaths };
}
