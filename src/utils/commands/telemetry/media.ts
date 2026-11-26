/**
 * Media Studio + Computer Use IPC 包装器（Phase 3 条目 13）。
 *
 * 5 个命令:list_media / image_process / screenshot / computer_use /
 * media_capabilities。
 */
import { invoke } from '@/utils/bridge';

export type ZhuyeImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

export interface ZhuyeMediaAsset {
  path: string;
  filename: string;
  sizeBytes: number;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  modifiedAtMs: number;
}

export interface ZhuyeImageProcessSpec {
  inputPath: string;
  outputPath: string;
  format?: ZhuyeImageFormat | null;
  width?: number | null;
  height?: number | null;
  quality?: number | null;
}

export interface ZhuyeImageProcessResult {
  outputPath: string;
  width: number;
  height: number;
  format: ZhuyeImageFormat;
  bytes: number;
}

export type ZhuyeComputerUseAction =
  | { kind: 'screenshot'; params: null }
  | { kind: 'mouseMove'; params: { x: number; y: number } }
  | { kind: 'mouseClick'; params: { x: number; y: number; button?: string } }
  | { kind: 'keyType'; params: { text: string } }
  | { kind: 'keyCombo'; params: { keys: string } }
  | { kind: 'scroll'; params: { dx: number; dy: number } };

export interface ZhuyeMediaCapabilities {
  imageBackend: string;
  computerBackend: string;
  note: string;
}

export function zhuye_list_media(dir: string): Promise<ZhuyeMediaAsset[]> {
  return invoke('zhuye_list_media', { dir });
}

export function zhuye_image_process(spec: ZhuyeImageProcessSpec): Promise<ZhuyeImageProcessResult> {
  return invoke('zhuye_image_process', { spec });
}

export function zhuye_screenshot(): Promise<string> {
  return invoke('zhuye_screenshot');
}

export function zhuye_computer_use(action: ZhuyeComputerUseAction): Promise<void> {
  return invoke('zhuye_computer_use', { action });
}

export function zhuye_media_capabilities(): Promise<ZhuyeMediaCapabilities> {
  return invoke('zhuye_media_capabilities');
}
