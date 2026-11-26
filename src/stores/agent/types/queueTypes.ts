/**
 * 跟进消息队列（C：Queue vs Steer）的条目类型。
 *
 * 从 `./types` 拆出（该文件已达行数预算）：队列条目是「运行中提交、
 * 留在前端可编辑」的消息，`items` 是真正发送的内容，`text` 只是预览。
 */
import type { UserInputItem } from '@/types/protocol';

export interface QueuedMessage {
  id: string;
  /** 完整 UserInputItem 列表（text + 附件），实际发送内容。 */
  items: UserInputItem[];
  /** 纯文本预览（首个 text item；用于待发送气泡展示与编辑）。 */
  text: string;
  /** 提交时注入的 workspace（入队时的现场）。 */
  workspace?: string | null;
  /** v1.x 后台持续运行:入队时盖章的会话 id（队列按会话隔离）。 */
  sessionId?: string;
  createdAt: number;
}
