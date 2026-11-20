/**
 * BrowserDockView —— 右 dock「浏览器」面板的表现层(纯展示)。
 *
 * 渲染层约束:不用 hook、不依赖 i18n / commands / 逻辑层 —— 全部文案
 * 由 feature 层翻译后经 props 传入(harness.css 的 `.browser` 面板类)。
 * 布局:`.bw-bar`(后退/前进/刷新 + 地址栏 + 设备档位 + 停止)→
 * `.bw-view`(运行中 = `.bw-frame > img.bw-shot` 实时画面;未启动 =
 * `.bw-empty` 引导)。按钮状态全部由 props 驱动,本层不持状态。
 */
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';

/** 渲染层 props(同构镜像声明,不反依赖逻辑层)。 */
export interface BrowserDockViewProps {
  /** 浏览器是否在运行。 */
  running: boolean;
  /** 当前帧 data URL(无帧为 null)。 */
  frame: string | null;
  /** 页面 URL(未知为 null;地址栏草稿初值的来源)。 */
  url: string | null;
  /** 启停/导航进行中。 */
  busy: boolean;
  /** 动作失败信息(条状展示,可重试)。 */
  error: string | null;
  /** 地址栏草稿值。 */
  urlDraft: string;
  /** 草稿编辑。 */
  onUrlDraftChange: (value: string) => void;
  /** 草稿提交(Enter)。 */
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  /** 当前设备档位 id(desktop / tablet / phone)。 */
  device: string;
  /** 设备档位(已翻译标签)。 */
  devices: Array<{ id: string; label: string }>;
  onDeviceChange: (id: string) => void;
  onStart: () => void;
  onStop: () => void;
  /* ===== 输入注入(由 feature 层注入,本层不碰 DOM 几何) ===== */
  /** 画面获得键盘焦点。 */
  onFrameFocus?: () => void;
  /** 画面失去键盘焦点。 */
  onFrameBlur?: () => void;
  /** 鼠标按下(画面坐标 → 归一化坐标由上层算)。 */
  onFramePointerDown?: (e: React.PointerEvent<HTMLImageElement>) => void;
  /** 鼠标移动(hover / 拖动)。 */
  onFramePointerMove?: (e: React.PointerEvent<HTMLImageElement>) => void;
  /** 鼠标抬起。 */
  onFramePointerUp?: (e: React.PointerEvent<HTMLImageElement>) => void;
  /** 指针离开画面。 */
  onFramePointerLeave?: (e: React.PointerEvent<HTMLImageElement>) => void;
  /** 滚轮。 */
  onFrameWheel?: (e: React.WheelEvent<HTMLImageElement>) => void;
  /** 按键按下。 */
  onFrameKeyDown?: (e: React.KeyboardEvent<HTMLImageElement>) => void;
  /** 按键抬起。 */
  onFrameKeyUp?: (e: React.KeyboardEvent<HTMLImageElement>) => void;
  /** 已翻译文案集合。 */
  labels: {
    back: string;
    forward: string;
    reload: string;
    urlPlaceholder: string;
    start: string;
    stop: string;
    stopHint: string;
    emptyTitle: string;
    emptyHint: string;
    waitFrame: string;
    /** 画面区域的无障碍标签(可交互浏览器)。 */
    frameLabel: string;
  };
}

export function BrowserDockView({
  running, frame, url, busy, error, urlDraft, onUrlDraftChange,
  onNavigate, onBack, onForward, onReload, device, devices, onDeviceChange,
  onStart, onStop, labels,
  onFrameFocus, onFrameBlur,
  onFramePointerDown, onFramePointerMove, onFramePointerUp, onFramePointerLeave,
  onFrameWheel, onFrameKeyDown, onFrameKeyUp,
}: BrowserDockViewProps) {
  return (
    <div className="browser" data-testid="browser-dock">
      <div className="bw-bar">
        <button
          type="button"
          className="tb-btn"
          title={labels.back}
          aria-label={labels.back}
          disabled={!running || busy}
          onClick={onBack}
          data-testid="browser-dock-back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title={labels.forward}
          aria-label={labels.forward}
          disabled={!running || busy}
          onClick={onForward}
          data-testid="browser-dock-forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title={labels.reload}
          aria-label={labels.reload}
          disabled={!running || busy}
          onClick={onReload}
          data-testid="browser-dock-reload"
        >
          <RotateCw size={14} />
        </button>

        <div className="bw-url" data-testid="browser-dock-url">
          <span className={`lk${running ? ' on' : ''}`} />
          <input
            value={urlDraft}
            placeholder={labels.urlPlaceholder}
            disabled={!running || busy}
            onChange={(e) => onUrlDraftChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(); }}
          />
        </div>

        <div className="seg">
          {devices.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === device ? 'on' : ''}
              disabled={busy}
              onClick={() => onDeviceChange(item.id)}
              data-testid={`browser-dock-device-${item.id}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 运行中才出停止键;未启动的入口在空态引导(避免 testid 重复)。 */}
        {running && (
          <button
            type="button"
            className="tb-btn"
            title={labels.stopHint}
            aria-label={labels.stop}
            disabled={busy}
            onClick={onStop}
            data-testid="browser-dock-stop"
          >
            {labels.stop}
          </button>
        )}
      </div>

      {error && (
        <div
          className="bw-dev-tag"
          style={{ padding: '6px 12px 0', color: 'var(--danger)' }}
          data-testid="browser-dock-error"
        >
          {error}
        </div>
      )}

      {!running ? (
        <div className="bw-view">
          <div className="bw-empty" data-testid="browser-dock-empty">
            <strong style={{ color: 'var(--fg-2)' }}>{labels.emptyTitle}</strong>
            <p>{labels.emptyHint}</p>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={onStart}
              data-testid="browser-dock-start"
            >
              {labels.start}
            </button>
          </div>
        </div>
      ) : (
        <div className="bw-view">
          <div className="bw-frame">
            {frame ? (
              <img
                className="bw-shot"
                src={frame}
                alt={url ?? labels.emptyTitle}
                // 等比缩放到面板宽度(screencast 帧最大 1280×800)。
                style={{ maxWidth: '100%', height: 'auto' }}
                data-testid="browser-dock-frame"
                /* 可交互浏览器:画面本身可聚焦并接收指针 / 键盘事件,
                   事件由 feature 层转成 CDP Input 域命令注入页面。 */
                tabIndex={0}
                role="application"
                aria-label={labels.frameLabel}
                onFocus={onFrameFocus}
                onBlur={onFrameBlur}
                onPointerDown={onFramePointerDown}
                onPointerMove={onFramePointerMove}
                onPointerUp={onFramePointerUp}
                onPointerLeave={onFramePointerLeave}
                onWheel={onFrameWheel}
                onKeyDown={onFrameKeyDown}
                onKeyUp={onFrameKeyUp}
              />
            ) : (
              <div className="bw-empty" data-testid="browser-dock-waiting">
                <p>{labels.waitFrame}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
