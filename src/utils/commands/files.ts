/**
 * 文件树 + read_file 封装 —— 浏览/编辑当前工作区。
 */
import { invoke } from '../bridge';

export interface ReflectDirEntry {
  name: string;
  path: string;
  /** "file" | "dir" | "symlink"。 */
  kind: string;
  size: number;
  /** Unix mtime 秒数。 */
  mtime: number;
  /** 距根目录的深度(0 = 根目录内容)。 */
  depth: number;
}

export interface ReflectDirListing {
  root: string;
  entries: ReflectDirEntry[];
  truncated: boolean;
}

export interface ReflectFileReadResult {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  truncated: boolean;
}

/**
 * 列出目录内容。跳过 dotfile 与常见的重型目录。
 * @param path  绝对路径,或 `null` 表示当前工作区
 * @param maxDepth  默认 4;总条目上限 2000。
 */
export async function reflect_list_dir(
  path: string | null,
  maxDepth = 4,
): Promise<ReflectDirListing> {
  return invoke<ReflectDirListing>('reflect_list_dir', { path, maxDepth: maxDepth });
}

/**
 * v1.x：Composer `@` 弹层专用 —— 列出当前工作区 depth=2 的目录条目。
 * 后端 `reflect_list_dir` 已跳过 dotfile + node_modules / target / dist / .git
 * （详见 `commands/files.rs::should_skip`），无需前端再做过滤。
 *
 * @param maxDepth  默认 2。深度 1 只列顶层目录；2 含一层子目录；过深会
 *                  触及 2000 条上限（monorepo 截断风险）。
 */
export async function listDirForMention(
  maxDepth = 2,
): Promise<ReflectDirListing> {
  return invoke<ReflectDirListing>('reflect_list_dir', {
    path: null,
    maxDepth,
  });
}

/** 读取文本文件(最大 1 MiB)。对二进制文件标记 `binary=true` 并返回空内容。 */
export async function reflect_read_file(path: string): Promise<ReflectFileReadResult> {
  return invoke<ReflectFileReadResult>('reflect_read_file', { path });
}

export interface ReflectImageBase64Result {
  /** 文件绝对路径。 */
  path: string;
  /** 按扩展名推断的 MIME(`image/png` 等)。 */
  mime_type: string;
  /** 文件字节的 base64(不带 data-URL 前缀)。 */
  base64: string;
  /** 原始字节数。 */
  size: number;
}

/**
 * 读取图片文件为 base64 —— Composer 拖拽附件管线用。
 *
 * 不做工作区沙盒(拖拽来源任意),扩展名白名单 png/jpg/jpeg/gif/webp/bmp,
 * 上限 20 MiB。返回后前端拼 `data:<mime>;base64,<b64>` 作为 inline image
 * 附件(core 的 LocalImage item 尚未接通,必须以字节提交)。
 */
export async function reflect_read_image_base64(
  path: string,
): Promise<ReflectImageBase64Result> {
  return invoke<ReflectImageBase64Result>('reflect_read_image_base64', { path });
}

/**
 * 写回文本文件(工作区沙盒内)。编辑器 Reject 恢复原文时用 inverse-patch
 * 重建内容后经此落盘;文件不存在时创建(含父目录)。
 */
export async function reflect_write_file(path: string, content: string): Promise<string> {
  return invoke<string>('reflect_write_file', { path, content });
}

export interface ReflectIngestUploadResult {
  /** 落盘文件的绝对路径(`<workspace>/.zhuye/uploads/<ts>_<name>`)。 */
  path: string;
  /** 写入字节数。 */
  size: number;
}

/**
 * 把 webview 侧只有字节、没有路径的文件（`<input type=file>` /
 * clipboardData / DOM drop 兜底）落盘到当前工作区 `.zhuye/uploads/`，
 * 返回真实路径 —— 引擎 `UserInputItem::File` 与 `/read` 都按路径消费，
 * 落在工作区内才能保证 agent 可读。上限 64 MiB。
 */
export async function reflect_ingest_upload(
  filename: string,
  base64: string,
): Promise<ReflectIngestUploadResult> {
  return invoke<ReflectIngestUploadResult>('reflect_ingest_upload', { filename, base64 });
}
