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

export const EFFORT_CAPABILITY_QUERY_KEY = ['effort-capability'] as const;

/** 全部档位(能力未知时的兜底展示)。 */
export const ALL_EFFORTS = ['low', 'medium', 'high', 'max', 'ultra'] as const;
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
  const { data } = useQuery({
    queryKey: EFFORT_CAPABILITY_QUERY_KEY,
    queryFn: zhuye_effort_capability,
    staleTime: 30_000,
  });
  return toCapabilityView(data);
}
