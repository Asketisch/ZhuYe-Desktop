/**
 * browserInput —— 面板输入的纯计算（坐标归一化 / 修饰键 / 双击判定）。
 *
 * 坐标约定：面板把画面按 `max-width: 100%` 缩放显示，物理像素与页面
 * 像素不是一回事。故前端统一送**归一化坐标**（0..1，相对画面元素），
 * 后端按页面 CSS 视口换算成页面坐标 —— 面板缩放、滚动都不影响落点。
 */

/** 元素矩形（只需 left / top / width / height）。 */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把比例值钳到 [0, 1]。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 客户端坐标 → 画面内的归一化坐标。
 *
 * 越界（点在画面外）时钳到边界 —— 拖动滑出画面时落点仍在边缘，
 * 不会跳到对侧。
 */
export function normalizedPoint(
  clientX: number,
  clientY: number,
  rect: FrameRect,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** 可打印字符才带 `text`（CDP 的 keyDown 需要它才产生字符输入）。 */
export function printableText(key: string): string | undefined {
  if (key.length !== 1) return undefined;
  const code = key.charCodeAt(0);
  // 控制字符（Enter=13、Tab=9 等）不带 text —— 它们有各自的键语义。
  if (code < 0x20) return undefined;
  return key;
}

/** 双击判定状态。 */
export interface ClickState {
  /** 上一次的点击序号（1 = 单击，2 = 双击 …）。 */
  count: number;
  /** 上一次点击的时间戳（ms）。 */
  time: number;
  /** 上一次点击的归一化坐标。 */
  x: number;
  y: number;
}

/** 两次点击判为同一串的间隔（ms）。 */
const DOUBLE_CLICK_MS = 500;
/** 两次点击判为同一位置的容差（归一化坐标）。 */
const DOUBLE_CLICK_SLOP = 0.01;

/**
 * 推进点击序号：间隔与位置都在容差内 → 序号 +1，否则重置为 1。
 *
 * 序号封顶 3（CDP 的 clickCount 语义：单击 / 双击 / 三击）。
 */
export function trackClick(
  prev: ClickState | null,
  now: number,
  x: number,
  y: number,
): { count: number; state: ClickState } {
  const near =
    prev !== null &&
    now - prev.time < DOUBLE_CLICK_MS &&
    Math.abs(prev.x - x) < DOUBLE_CLICK_SLOP &&
    Math.abs(prev.y - y) < DOUBLE_CLICK_SLOP;
  const count = near ? Math.min(3, prev.count + 1) : 1;
  return { count, state: { count, time: now, x, y } };
}
