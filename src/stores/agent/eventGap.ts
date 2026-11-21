/**
 * v1.12:会话扇出序号跟踪 + 缺口重放收敛。
 *
 * `Event.seq`(引擎会话扇出出口统一赋号,per-session 单调从 1 起)让前端
 * 首次能**检测**到丢事件:broadcast 慢订阅 / 主线程卡顿丢弃 delta 后,
 * 此前前端状态静默发散且无任何线索。缺口 = `seq > last + 1`(首条或
 * 换会话后 last=0 不判定,等水位建立);seq=0 为 per-turn 专属流,
 * 不参与缺口判定。`zhuye_event_gap`(转发器 broadcast Lagged 的合成通知)
 * 是第二条触发路径,覆盖 per-turn 快路丢包 —— 两条路径共用同一收敛:
 * 当前会话 re-replay(重放覆盖落盘部分;半截流式文本本就不入盘)。
 */
import type { ZhuyeEvent } from '@/types/protocol';

export interface SessionSeqTracker {
  /** 消费一条事件;返回 true 表示检测到缺口(需要重同步)。 */
  observe: (event: ZhuyeEvent) => boolean;
  /** 换会话 / 重放后复位水位(引擎 per-session 计数,重新跟踪)。 */
  reset: () => void;
  /** 直接触发重同步(zhuye_event_gap 路径:转发器 Lagged,无 seq 可比对)。 */
  forceResync: () => void;
}

/** 创建带防抖的 seq 跟踪器;`resync` 在缺口与 gap 通知两条路径上被调用。 */
export function createSessionSeqTracker(resync: () => void): SessionSeqTracker {
  let lastSessionSeq = 0;
  let resyncInFlight = false;
  const triggerResync = () => {
    if (resyncInFlight) return; // 一次缺口风暴只同步一次
    resyncInFlight = true;
    resync();
    // 重放是异步的,这里仅以宏任务近似「在飞窗口」;重放完成后由调用方
    // 状态水合驱动后续事件继续判定(重复触发有防抖兜底,无害)。
    queueMicrotask(() => {
      resyncInFlight = false;
    });
  };
  return {
    observe: (event) => {
      if (event.seq <= 0) return false;
      const gap = lastSessionSeq > 0 && event.seq > lastSessionSeq + 1;
      lastSessionSeq = event.seq;
      if (gap) triggerResync();
      return gap;
    },
    reset: () => {
      lastSessionSeq = 0;
    },
    forceResync: triggerResync,
  };
}
