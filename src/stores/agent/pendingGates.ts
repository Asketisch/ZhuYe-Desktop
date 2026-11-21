/**
 * v1.12:引擎侧挂起交互快照(bind 返回的 pending_gates)→ 合成事件流。
 *
 * 零语义复制:把快照行还原为对应 EventMsg 变体,走同一份 reduceEvent
 * 构造 pending(pending 构造逻辑与 live 路径完全一致,本文件不复制任何
 * 字段映射之外的事件语义)。调用方(store.hydratePendingGates)按
 * request_id 去重后逐条 reduce —— 后台 scratch 注回(mergePendingInto)
 * 是同进程内更鲜的投影,已在场的挂起态不重复添加。
 */
import type { PendingGateSnapshot, ZhuyeEventMsg } from '@/types/protocol';

/** 把一条快照行还原为合成事件;未知 kind 返回 null(前向容错跳过)。 */
function gateToSynthetic(gate: PendingGateSnapshot): ZhuyeEventMsg | null {
  const base = { request_id: gate.request_id };
  switch (gate.kind.type) {
    case 'tool':
      // 原始 args 在 payload 里;「始终允许这条命令」推导依赖它。
      return {
        type: 'approval_request',
        ...base,
        kind: {
          type: 'tool',
          tool_name: gate.kind.tool_name,
          args: (gate.payload as { args?: unknown } | null | undefined)?.args ?? null,
        },
        risk: 'medium',
      } as unknown as ZhuyeEventMsg;
    case 'hook':
      return {
        type: 'approval_request',
        ...base,
        kind: {
          type: 'hook',
          hook_name: gate.kind.hook_name,
          decision_preview: gate.summary,
        },
        risk: 'high',
      } as unknown as ZhuyeEventMsg;
    case 'question':
      return {
        type: 'ask_user_question',
        ...base,
        questions: (gate.payload as { questions?: unknown[] } | null | undefined)?.questions ?? [],
      } as unknown as ZhuyeEventMsg;
    case 'ask_user':
      return {
        type: 'ask_user',
        ...base,
        prompt: (gate.payload as { prompt?: string } | null | undefined)?.prompt ?? gate.summary,
        secret: Boolean((gate.payload as { secret?: boolean } | null | undefined)?.secret),
        placeholder: (gate.payload as { placeholder?: string } | null | undefined)?.placeholder ?? null,
      } as unknown as ZhuyeEventMsg;
    case 'plan':
      // plan 快照:payload 带 markdown(ready)或 task(request)。
      if ((gate.payload as { markdown?: string } | null | undefined)?.markdown) {
        return {
          type: 'plan_ready',
          ...base,
          plan_id: gate.kind.plan_id,
          markdown: (gate.payload as { markdown?: string }).markdown ?? '',
          path: null,
        } as unknown as ZhuyeEventMsg;
      }
      return {
        type: 'plan_request',
        plan_id: gate.kind.plan_id,
        task: (gate.payload as { task?: string } | null | undefined)?.task ?? gate.summary,
      } as unknown as ZhuyeEventMsg;
    default:
      return null;
  }
}

/** 快照行数组 → 去重后的合成事件流(按已知 request_id 过滤)。 */
export function gatesToSyntheticEvents(
  gates: PendingGateSnapshot[],
  knownIds: Iterable<string>,
): ZhuyeEventMsg[] {
  const known = new Set(knownIds);
  const out: ZhuyeEventMsg[] = [];
  for (const gate of gates) {
    if (known.has(gate.request_id)) continue;
    const msg = gateToSynthetic(gate);
    if (msg) out.push(msg);
  }
  return out;
}
