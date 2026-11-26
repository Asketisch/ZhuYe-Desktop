/**
 * useModelAbilities —— 单模型能力查询（models.dev 目录，不发网络请求）。
 *
 * 数据源是引擎侧「内嵌快照 + 磁盘缓存取新」的进程级目录（窗口 / 输出
 * 上限 / 视觉 / 思考档位），查询为纯内存操作；模型卡片展示与 composer
 * 发送前的视觉检查共用本 hook。staleTime 放长，避免模型切换的高频
 * 渲染每次都打一遍 IPC。
 */
import { useQuery } from '@tanstack/react-query';
import { zhuye_lookup_model_abilities } from '@/utils/commands/models';

/** 能力查询的缓存键前缀（model spec 作后缀）。 */
export const MODEL_ABILITIES_QUERY_KEY = ['model-abilities'] as const;

/** 查询单个模型的能力；`modelSpec` 为空时禁用（返回 loading 态）。 */
export function useModelAbilities(modelSpec: string | null | undefined) {
  const id = modelSpec?.trim() || null;
  return useQuery({
    queryKey: [...MODEL_ABILITIES_QUERY_KEY, id],
    queryFn: () => zhuye_lookup_model_abilities(id!),
    enabled: id != null,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
