/**
 * Provider 模型列表查询封装。
 *
 * 对着 base_url + api_key 拉取可用模型（`reflect_list_provider_models`），
 * 两种接入端口：anthropic（/v1/models）与 openai（/models，兼容多数
 * OpenAI 兼容网关）。能力信息 live 披露优先；未披露的字段由 models.dev
 * 社区目录补齐（Anthropic 官方端口也有窗口/输出/视觉/思考数据），
 * 两边都没说时为 null。
 */
import { invoke } from '../bridge';

/** 单个模型条目（对齐后端 `ProviderModelInfo`）。 */
export interface ProviderModelInfo {
  /** 模型 id，直接作为 model spec 使用。 */
  id: string;
  /** 展示名（厂商未返回时与 id 相同）。 */
  display_name: string;
  /** 视觉输入能力；null = live 与目录都没说，由用户自行判断。 */
  supports_vision: boolean | null;
  /**
   * 是否免费：`true` / `false` = 已判定；`null` = **未知**
   * （厂商没表态，判定规则也没命中 —— 此时不能断言免费）。
   *
   * 判定规则来自配置里的 `[model_discovery]` 段（`always_free` /
   * `free_id_patterns`），与引擎跑 `model = "free"` 时用的是同一套规则。
   */
  is_free: boolean | null;
  /** 上下文窗口 token（live / 目录都没披露时为 null）。 */
  context_window: number | null;
  /** 最大输出 token（live / 目录都没披露时为 null）。 */
  max_output_tokens: number | null;
  /** 是否具备思考能力（models.dev 目录投票）；null = 未知。 */
  supports_reasoning: boolean | null;
}

/** 模型列表 + 查询端口。 */
export interface ProviderModelsResult {
  endpoint: string;
  models: ProviderModelInfo[];
}

/** 单模型能力查询结果（对齐后端 `ModelAbilitiesResult`）。 */
export interface ModelAbilitiesResult {
  /** 上下文窗口 token；null = 未知。 */
  context_window: number | null;
  /** 最大输出 token；null = 未知。 */
  max_output_tokens: number | null;
  /** 是否接受图片输入；null = 未知（**未知不拦截发送**）。 */
  supports_vision: boolean | null;
  /** 是否具备思考能力；null = 未知。 */
  supports_reasoning: boolean | null;
  /** 思考档位菜单（厂商词表原样，如 `["low","medium","high"]`）。 */
  effort_levels: string[] | null;
}

/**
 * 拉取指定 base_url + api_key 下的可用模型列表。
 * `endpoint` 仅接受 'anthropic' | 'openai'（接入端口，与 plans 的
 * provider 字段一致）。鉴权失败 / 网络错误会 reject，调用方自行展示。
 */
export async function reflect_list_provider_models(
  base_url: string,
  api_key: string,
  endpoint: string,
): Promise<ProviderModelsResult> {
  return invoke<ProviderModelsResult>('reflect_list_provider_models', {
    baseUrl: base_url,
    apiKey: api_key,
    endpoint,
  });
}

/**
 * 向 provider 发送测试消息「你好」（max_tokens 压到 32，无 system、无
 * tools，避免无效消耗），验证鉴权/网络/推理链路。返回模型回复文本。
 */
export async function reflect_test_provider_chat(
  base_url: string,
  api_key: string,
  endpoint: string,
  model: string,
): Promise<{ reply: string }> {
  return invoke<{ reply: string }>('reflect_test_provider_chat', {
    baseUrl: base_url,
    apiKey: api_key,
    endpoint,
    model,
  });
}

/**
 * 查单个模型的能力（窗口 / 输出上限 / 视觉 / 思考），不依赖 provider
 * 实拉 —— 数据来自 models.dev 目录（内嵌快照 + 磁盘缓存），纯查询不
 * 发网络请求。供模型卡片展示与 composer 发送前的视觉检查。
 */
export async function reflect_lookup_model_abilities(
  modelId: string,
): Promise<ModelAbilitiesResult> {
  return invoke<ModelAbilitiesResult>('reflect_lookup_model_abilities', { modelId });
}
