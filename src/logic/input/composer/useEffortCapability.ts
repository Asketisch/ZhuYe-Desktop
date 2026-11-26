/**
 * 思考强度能力 —— Composer 控制条与 Models 页共用的数据源。
 *
 * 后端按**当前模型**算出:支持哪些档位、用户选的档实际生效为什么。桌面端
 * 据此只提供可选档位,并把「用户选择」与「实际生效」分开显示 —— 用户偏好
 * 始终保留,换模型后自动按新模型重算。
 *
 * 能力未知(私有模型 / 兼容网关)时后端返回 `known = false`:此时仍展示全部
 * 档位(用户可以先选),引擎在服务端拒绝时自动降级。
 */
import { useQuery } from '@tanstack/react-query';
import { zhuye_effort_capability, type ZhuyeEffortCapability } from '@/utils/commands/permissions';
import { useAgentStore } from '@/stores/agentStore';

/**
 * 按当前模型 spec 分键的 capability 查询 —— 换模型即换 key。
 *
 * 旧实现 queryKey 恒为 `['effort-capability']` 且 staleTime 30s:切换模型
 * 后端快照已按新模型重算,但前端缓存不失效,pill 继续显示旧模型档位。
 * 现在 key 带 store 的 session.model(引擎 session_configured / 模型切换
 * 链路维护),spec 变化 → 新 key → 重新拉取;同 spec 30s 内仍去重。
 */
export const effortCapabilityQueryKey = (modelSpec: string) =>
  ['effort-capability', modelSpec] as const;

/** 全部档位(能力未知时的兜底展示;含上游 fix/effort-xhigh-ladder 新增的 xhigh)。 */
export const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = (typeof ALL_EFFORTS)[number];

export interface EffortCapabilityView {
  /** 可供选择的档位。 */
  options: Effort[];
  /** 能力是否已知(未知时展示全部档位)。 */
  known: boolean;
  /** 用户选择的档位。 */
  requested: Effort;
  /** 实际生效的档位;`null` = 完全不发思考参数。 */
  effective: Effort | null;
  /** 生效档位与用户选择不一致。 */
  adjusted: boolean;
  /** 当前模型 spec。 */
  model: string;
}

const FALLBACK: EffortCapabilityView = {
  options: [...ALL_EFFORTS],
  known: false,
  requested: 'low',
  effective: 'low',
  adjusted: false,
  model: '',
};

function toEffort(value: string): Effort {
  return (ALL_EFFORTS as readonly string[]).includes(value) ? (value as Effort) : 'low';
}

/** 把后端快照转成视图模型。 */
export function toCapabilityView(
  capability: ZhuyeEffortCapability | undefined,
): EffortCapabilityView {
  if (!capability) return FALLBACK;
  const supported = capability.supported.map(toEffort);
  const options = capability.known
    ? supported.length > 0
      ? supported
      : []
    : [...ALL_EFFORTS];
  return {
    options,
    known: capability.known,
    requested: toEffort(capability.requested),
    effective: capability.effective ? toEffort(capability.effective) : null,
    adjusted: capability.adjusted,
    model: capability.model,
  };
}

export function useEffortCapability(): EffortCapabilityView {
  // 当前模型 spec:引擎 session_configured 事件维护;pre-install 阶段为空
  // (后端回落保守表,known=true 但 options 是保守阶梯)。
  const sessionModel = useAgentStore((st) => st.session?.model ?? '');
  const { data } = useQuery({
    queryKey: effortCapabilityQueryKey(sessionModel),
    queryFn: zhuye_effort_capability,
    staleTime: 30_000,
  });
  return toCapabilityView(data);
}
