/**
 * useComposerFileEntries —— Composer 附件三入口聚合(A1)。
 *
 * 把「图片内联 / 文件落盘 / 原生拖拽」三条附件进入路径收敛到一个 hook,
 * Composer 只消费回调:
 * - 附件按钮:Tauri 下 `zhuye_pick_files` 原生多选拿真实路径(与 Finder
 *   拖拽同款分流);浏览器/测试 invoke 降级返回 undefined → 回落隐藏
 *   DOM input(字节经 useFileIngest 落盘)。
 * - 粘贴 / DOM drop 兜底:图片字节 → base64 内联;其余 → useFileIngest
 *   落盘为工作区内真实路径 file mention(不再放 `(file) 名字` 假占位)。
 * - 原生拖拽(useComposerDragDrop)负责 Tauri WKWebView 下 Finder 拖入。
 */
import { useCallback, useRef, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { zhuye_pick_files } from '@/utils/commands/workspaces';
import { useAttachments } from './useAttachments';
import { useFileIngest } from './useFileIngest';
import { useComposerDragDrop } from './useComposerDragDrop';

export function useComposerFileEntries(fileInputRef: RefObject<HTMLInputElement | null>) {
  const attachments = useAttachments();
  const ingest = useFileIngest(attachments);
  // DOM drop 仅作浏览器/测试兜底;Tauri(WKWebView)下 Finder 拖入的文件
  // 不进 dataTransfer,由原生事件接管(nativeDrop=true 时抑制 DOM 兜底,
  // 防双通道重复添加)。
  const drop = useComposerDragDrop(attachments);
  const dropRef = useRef(drop);
  dropRef.current = drop;

  // 图片字节 → base64 内联附件(选择器 / 粘贴 / DOM drop 兜底共用)。
  const addImageFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') attachments.addInlineImage(reader.result, file.type);
      };
      reader.readAsDataURL(file);
    },
    [attachments],
  );

  const onPickImage = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => {
        if (file.type.startsWith('image/')) addImageFile(file);
      });
    },
    [addImageFile],
  );

  // 字节流按类型分流:图片内联,其余经 useFileIngest 落盘转 file mention。
  const splitByType = (files: File[]): { images: File[]; others: File[] } => {
    const images: File[] = [];
    const others: File[] = [];
    for (const file of files) {
      (file.type.startsWith('image/') ? images : others).push(file);
    }
    return { images, others };
  };

  const onAttachFile = useCallback(() => {
    void zhuye_pick_files().then((paths) => {
      if (paths === undefined) {
        fileInputRef.current?.click();
        return;
      }
      // null = 用户取消;空数组同场处理,均不再弹 DOM 选择器。
      if (paths && paths.length > 0) void dropRef.current.ingestPaths(paths);
    });
  }, [fileInputRef]);

  const onPickFile = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const { images, others } = splitByType(Array.from(files));
      images.forEach(addImageFile);
      ingest.ingestFiles(others);
    },
    [addImageFile, ingest],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const fileList: File[] = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file) fileList.push(file);
      }
      if (fileList.length === 0) return;
      event.preventDefault();
      const { images, others } = splitByType(fileList);
      images.forEach(addImageFile);
      ingest.ingestFiles(others);
    },
    [addImageFile, ingest],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (drop.nativeDrop) return;
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      const { images, others } = splitByType(Array.from(files));
      images.forEach(addImageFile);
      ingest.ingestFiles(others);
    },
    [addImageFile, drop.nativeDrop, ingest],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  }, []);

  return {
    attachments,
    ingest,
    drop,
    onPickImage,
    onAttachFile,
    onPickFile,
    onPaste,
    onDrop,
    onDragOver,
  };
}
