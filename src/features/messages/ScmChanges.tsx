/**
 * ScmChanges —— F52 会话内 SCM 消息-文件联动面板。
 *
 * 数据源:agentStore.turns —— 从 write/edit 类工具的 tool_output.path
 * 派生「哪个回合改了哪些文件」。纯前端派生,无需引擎新事件
 * (引擎侧 `zhuye-telemetry::desktop_contracts::ScmChange` 为对应契约)。
 */
import { useMemo, useState } from 'react';
import { FileDiff, ChevronDown, ChevronRight } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useAgentStore, type Turn, type TurnItem } from '@/stores/agentStore';
import s from '@/render/messages/ScmChanges.module.css';

/** 写类工具名(改文件的才进 SCM 面板)。 */
const WRITE_TOOLS = new Set([
  'write_file',
  'file_write',
  'edit',
  'edit_file',
  'create_file',
  'plan_write',
  'delete',
  'file_delete',
]);

/** 从单条 turn 派生的文件变更。 */
export interface DerivedChange {
  turnId: string;
  path: string;
  isError: boolean;
}

/** 从 turn 的 items 里提取写类工具的目标路径(纯函数,供测试)。 */
export function deriveChangesFromTurn(turn: Turn): DerivedChange[] {
  const out: DerivedChange[] = [];
  const seen = new Set<string>();
  for (const item of turn.items as TurnItem[]) {
    if (item.kind !== 'tool_output') continue;
    // 配对的 tool_call 判工具名。
    const call = turn.items.find(
      (i): i is Extract<TurnItem, { kind: 'tool_call' }> =>
        i.kind === 'tool_call' && i.callId === item.callId,
    );
    if (!call || !WRITE_TOOLS.has(call.toolName)) continue;
    const path = item.path || argsPath(call.argsSummary) || argsPath(call.argsStream);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ turnId: turn.id, path, isError: item.isError });
  }
  return out;
}

/** 从 args JSON 里取 path 字段。 */
function argsPath(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { path?: unknown };
    return typeof parsed.path === 'string' && parsed.path ? parsed.path : null;
  } catch {
    return null;
  }
}

/** 把路径分组到回合(纯函数:turns → 每回合的变更)。 */
export function groupChangesByTurn(turns: Turn[]): { turnId: string; changes: DerivedChange[] }[] {
  return turns
    .map((t) => ({ turnId: t.id, changes: deriveChangesFromTurn(t) }))
    .filter((g) => g.changes.length > 0);
}

export function ScmChanges() {
  const turns = useAgentStore((st) => st.turns);
  const [collapsed, setCollapsed] = useState(false);

  const groups = useMemo(() => groupChangesByTurn(turns), [turns]);
  const total = groups.reduce((n, g) => n + g.changes.length, 0);

  if (total === 0) return null;

  return (
    <div className={s.panel} data-testid="scm-changes">
      <button
        type="button"
        className={s.header}
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <Icon icon={collapsed ? ChevronRight : ChevronDown} size={12} />
        <Icon icon={FileDiff} size={12} />
        <span>
          本会话改动 {total} 个文件({groups.length} 轮)
        </span>
      </button>
      {!collapsed && (
        <ul className={s.list}>
          {groups.map((g) => (
            <li key={g.turnId}>
              <span className={s.turn}>回合 {g.turnId.slice(0, 8)}</span>
              <ul>
                {g.changes.map((c) => (
                  <li
                    key={`${c.turnId}:${c.path}`}
                    className={c.isError ? s.failed : ''}
                    data-testid="scm-change-row"
                  >
                    {c.path}
                    {c.isError ? ' (失败)' : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
