import type { I18nContextValue } from '@/utils/i18n/context';

/**
 * 泳道视图契约 —— harness 单色版「子代理并行执行」页。
 *
 * 两个数据源(引擎子代理快照 + side-channel)在控制器层归一成
 * `LaneRow`,展示组件只消费投影。
 */

/** 泳道行状态基调(对应 `.lane` 的修饰类 run/ok/err/done)。 */
export type LaneTone = 'run' | 'ok' | 'err' | 'done';

/** 单个执行步骤 chip(对应 `.lane-step` 的 done/run/err)。 */
export interface LaneStep {
  label: string;
  tone: 'done' | 'run' | 'err';
}

/** 一条归一后的泳道。 */
export interface LaneRow {
  /** 唯一 key(child_id / side-channel id)。 */
  id: string;
  /** 展示名(role / agentName)。 */
  name: string;
  /** 任务 / 最近活动摘要。 */
  task: string;
  /** 状态基调。 */
  tone: LaneTone;
  /** 是否仍在运行。 */
  running: boolean;
  /** 执行步骤 chips。 */
  steps: LaneStep[];
  /** 累计 token(未知为 null)。 */
  tokens: number | null;
  /** 已运行时长(秒;未知为 null)。 */
  durationSec: number | null;
  /** 进度百分比;null = 不定进度(满条渲染)。 */
  percent: number | null;
}

/** 泳道页展示契约。 */
export interface LanesViewProps {
  t: I18nContextValue['t'];
  /** 头部副标题中的会话短 id 标签(无会话时为 null)。 */
  sessionLabel: string | null;
  /** 汇总:在途。 */
  runningCount: number;
  /** 汇总:已完成。 */
  doneCount: number;
  /** 汇总:失败。 */
  failedCount: number;
  /** 泳道列表。 */
  lanes: LaneRow[];
  /** 是否有在飞(中止全部按钮可用性)。 */
  hasRunning: boolean;
  /** 中止全部请求进行中。 */
  busy: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onCancelAll: () => void;
}
