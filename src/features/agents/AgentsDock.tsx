/**
 * AgentsDock —— 右 dock「子代理记录」面板（harness 单色设计）。
 *
 * 结构对应 harness.css `.sagents` 块：顶栏（标题 + 会话短 id · 数量 +
 * 刷新）+ 记录列表。每条记录（`.sa`,`data-st` 驱动状态点）可展开：
 * 上下文占用环（`.ctx-ring sm`,窗口未知时省略）+ 子代理中间消息
 * （`.think`）+ 工具调用行（`.tool`）+ 最近事件摘要（`.sa-out`）。
 *
 * 数据面在 `@/logic/agents/useAgentsDock`（store 双通道,此处纯渲染）。
 */
import { useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import { useContextRatio } from '@/logic/shell/useContextRatio';
import { useAgentsDock, formatDuration, type AgentsDockRecord, type AgentsDockTool } from '@/logic/agents/useAgentsDock';

/** 会话短 id（侧栏同款口径:uuid 前 8 位）。 */
function shortId(id: string | null): string | null {
  return id ? id.slice(0, 8) : null;
}

/**
 * 上下文占用环（`.ctx-ring sm`）—— 子代理累计 token / 模型上下文窗口。
 * 窗口大小未知（store 未上报 session_configured）时返回 null,外层省略。
 */
function CtxRing({ tokens, windowSize }: { tokens: number; windowSize: number | null }) {
  const { t } = useI18n();
  if (!windowSize || windowSize <= 0 || tokens <= 0) return null;
  const pct = Math.min(100, Math.round((tokens / windowSize) * 100));
  return (
    <div className="ctx-ring sm" title={t('harness.agents.ctx', { tokens: tokens.toLocaleString(), pct })}>
      <svg className="ctx-ring-svg" viewBox="0 0 30 30" aria-hidden="true">
        <circle className="cr-bg" cx="15" cy="15" r="12.5" />
        {/* pathLength=100 归一化 dash 单位,免算周长 */}
        <circle
          className="cr-fg"
          cx="15"
          cy="15"
          r="12.5"
          pathLength={100}
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      <span className="ctx-ring-num">{pct}</span>
    </div>
  );
}

/** 工具调用行（`.tool`）—— feed 只转发工具名与成败,参数 / 输出正文
 * 后端不下发,故 `.term` 正文仅在拿到文本时渲染（当前恒缺省）。 */
function ToolRow({ tool }: { tool: AgentsDockTool }) {
  const dur = tool.durationMs !== null ? formatDuration(tool.durationMs) : tool.open ? '…' : null;
  return (
    <div className="tool">
      <div className="tool-head">
        <span className="ic"><Wrench size={11} strokeWidth={1.5} aria-hidden /></span>
        <span className="nm">{tool.name}</span>
        {tool.failed && <span className="arg">✕</span>}
        {dur && <span className="dur">{dur}</span>}
      </div>
    </div>
  );
}

/** 单条子代理记录（`.sa`,本地展开态）。 */
function AgentRecord({ rec, index }: { rec: AgentsDockRecord; index: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ctx = useContextRatio();
  const taskText = rec.task ?? t('harness.agents.iter', { n: rec.iteration });
  return (
    <div
      className={`sa${open ? ' open' : ''}`}
      data-st={rec.st}
      data-testid={`agents-dock-record-${index}`}
    >
      <button
        type="button"
        className="sa-head"
        style={{ width: '100%' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sa-dot" />
        <span className="sa-nm">{rec.role}</span>
        <span className="sa-task">{taskText}</span>
        <span className="sa-dur">{rec.durationText}</span>
        <span className="sa-chev">›</span>
      </button>
      {open && (
        <div className="sa-body">
          <div className="sa-ctx">
            <CtxRing tokens={rec.totalTokens} windowSize={ctx.windowSize} />
            <span className="sa-ctx-txt">
              {t('harness.agents.tokens', { n: rec.totalTokens.toLocaleString() })}
            </span>
          </div>
          {rec.messages.length > 0 && (
            <details className="think">
              <summary>{t('harness.agents.messages', { n: rec.messages.length })}</summary>
              <div className="body">{rec.messages.join('\n\n')}</div>
            </details>
          )}
          {rec.tools.map((tool, i) => (
            <ToolRow key={`${tool.name}-${i}`} tool={tool} />
          ))}
          {rec.lastEvent && <div className="sa-out">{rec.lastEvent}</div>}
        </div>
      )}
    </div>
  );
}

export function AgentsDock() {
  const { t } = useI18n();
  const { activeId, records, refresh } = useAgentsDock();
  const sid = shortId(activeId);
  return (
    <div className="sagents" data-testid="agents-dock">
      <div className="sa-bar">
        <span className="sa-title">{t('harness.agents.title')}</span>
        <span className="sa-sub">
          {sid
            ? t('harness.agents.session', { id: sid, count: records.length })
            : t('harness.agents.noSession')}
        </span>
        <span className="tp-spacer" />
        <button
          type="button"
          className="tb-btn"
          title={t('harness.agents.refresh')}
          aria-label={t('harness.agents.refresh')}
          onClick={refresh}
          data-testid="agents-dock-refresh"
        >
          <RefreshCw size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="sa-list">
        {records.length === 0 ? (
          <div className="us-empty">{t('harness.agents.empty')}</div>
        ) : (
          records.map((rec, i) => <AgentRecord key={rec.childId || `idx-${i}`} rec={rec} index={i} />)
        )}
      </div>
    </div>
  );
}
