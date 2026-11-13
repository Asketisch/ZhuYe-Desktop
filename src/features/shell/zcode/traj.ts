/**
 * traj —— 从既有 agent store 的 turns 推导轨迹账本(redesign/zcode-shell)。
 *
 * ui-trajectory 口径:turn-aware 事件账本,User/Assistant/Reasoning/Tool/
 * Compaction 分组,轮次边界打点。数据源 = store.turns(turn_id + items)+
 * compactions(压缩明细),不新增 IPC、不改 reducer。
 *
 * 三泳道 Timing:协议事件不带逐条时钟,这里用**条目序号均匀投影**(诚实
 * 降级:真实计时落库后再换算),输入/模型/工具三条泳道按条目类型归 lane。
 */
import type { Turn, TurnItem } from '@/stores/agentStore';
import type { CompactionStats } from '@/stores/agent/types';

export type TrajRole = 'user' | 'assistant' | 'reasoning' | 'tool_call' | 'error';

export interface TrajEntry {
  /** 稳定 key(react key 用)。 */
  key: string;
  role: TrajRole;
  /** 轮次序号(1 起)。 */
  turn: number;
  /** 轮内步数(1 起)。 */
  step: number;
  /** 轮次/步骤边界(账本左缘圆点)。 */
  boundary: boolean;
  /** 工具行:工具名(如 bash / read_file)。 */
  toolName?: string;
  /** 工具行:参数摘要(JSON 截断)。 */
  args?: string;
  /** 主体文本(助手/思考/输出/错误)。 */
  text: string;
  /** 工具输出错误。 */
  isError?: boolean;
  /** 工具输出 diff(编辑类)。 */
  diff?: string;
  /** 目标文件路径(edit/write)。 */
  path?: string;
  /** 是否子调用展示态(工具输出的缩进行)。 */
  sub?: boolean;
  /** streaming 中。 */
  streaming?: boolean;
}

export interface TrajLaneSeg {
  /** 泳道:input / model / tool。 */
  lane: 'input' | 'model' | 'tool';
  /** 左端百分比(0-100)。 */
  left: number;
  /** 宽度百分比(0-100)。 */
  width: number;
  /** 关联账本条目序号(选中环联动)。 */
  entryIndex: number;
  isError?: boolean;
}

function truncate(text: string, max = 160): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

/** turns + compactions → 轨迹账本(扁平、带轮次/步进边界)。 */
export function deriveTrajEntries(turns: Turn[], compactions: CompactionStats): TrajEntry[] {
  const out: TrajEntry[] = [];
  turns.forEach((turn, ti) => {
    let step = 0;
    turn.items.forEach((item: TurnItem, ii) => {
      step += 1;
      const key = `${turn.id}:${ii}`;
      const boundary = ii === 0;
      const base = { key, turn: ti + 1, step, boundary };
      switch (item.kind) {
        case 'user_text':
          out.push({ ...base, role: 'user', text: truncate(item.text) });
          break;
        case 'assistant_text':
          out.push({ ...base, role: 'assistant', text: truncate(item.text), streaming: item.streaming });
          break;
        case 'thinking':
          out.push({ ...base, role: 'reasoning', text: truncate(item.text) });
          break;
        case 'tool_call':
          out.push({
            ...base,
            role: 'tool_call',
            toolName: item.toolName,
            args: truncate(item.argsSummary || item.argsStream || '', 96),
            text: '',
            streaming: item.status === 'running',
          });
          break;
        case 'tool_output':
          // 工具输出作为**子调用缩进行**紧随其 call;错误标记上浮。
          out.push({
            ...base,
            role: 'tool_call',
            sub: true,
            toolName: 'output',
            text: truncate(item.text, 120),
            isError: item.isError,
            diff: item.diff || undefined,
            path: item.path || undefined,
          });
          break;
        case 'error':
          out.push({ ...base, role: 'error', text: truncate(item.text) });
          break;
      }
    });
    // turn 结束后若该轮发生压缩,插入 Between-turns 压缩记录(倒序取属于
    // 该轮的明细不可得,如实放最近一条摘要)。
  });
  if (compactions.count > 0) {
    out.push({
      key: 'compaction',
      role: 'reasoning',
      turn: turns.length,
      step: 0,
      boundary: false,
      sub: true,
      text: truncate(
        compactions.last ??
          `compaction ×${compactions.count} · −${compactions.removedMessages} msgs · −${compactions.tokensSaved} tok`,
        120,
      ),
    });
  }
  return out;
}

/** 账本条目 → 三泳道 Timing 段(按条目序均匀投影)。 */
export function deriveLanes(entries: TrajEntry[]): TrajLaneSeg[] {
  const n = entries.length;
  if (n === 0) return [];
  const unit = 100 / n;
  const segs: TrajLaneSeg[] = [];
  entries.forEach((e, i) => {
    const left = i * unit;
    const width = Math.max(unit * 0.55, 1);
    if (e.role === 'user') {
      segs.push({ lane: 'input', left, width: Math.max(width * 0.5, 1), entryIndex: i });
    } else if (e.role === 'assistant' || e.role === 'reasoning') {
      segs.push({ lane: 'model', left, width, entryIndex: i });
    } else if (e.role === 'tool_call' || e.role === 'error') {
      segs.push({ lane: 'tool', left, width, entryIndex: i, isError: e.role === 'error' || e.isError });
    }
  });
  return segs;
}

/** 检查器 JSON 转义(工具参数展示)。 */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
