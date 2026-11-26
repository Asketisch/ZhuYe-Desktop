/**
 * Agent 状态 / config TOML / 工具注册表 封装。
 *
 * `ZhuyeAgentStatus` 驱动状态徽标与降级模式 CTA。
 * TOML 命令封装 `~/.zhuye/config.toml` 的原始读写 —— 后端在写入磁盘前
 * 仍会进行合法性校验与解析。
 */
import { invoke } from '../../bridge';

/** agent 状态快照 —— 前端状态徽标 + 降级引导用。 */
export interface ZhuyeAgentStatus {
  ready: boolean;
  has_model: boolean;
  model: string;
  workspace: string;
  degraded_reason: string | null;
}

/** 单个工具的 name + description。 */
export interface ZhuyeToolInfo {
  name: string;
  description: string;
}

/** 返回 agent 状态(ready / has_model / model / workspace / degraded_reason)。 */
export async function zhuye_agent_status(): Promise<ZhuyeAgentStatus> {
  return invoke<ZhuyeAgentStatus>('zhuye_agent_status');
}

/** 读取 ~/.zhuye/config.toml 的 TOML 字符串。Settings 页加载用。 */
export async function zhuye_get_config(): Promise<string> {
  return invoke<string>('zhuye_get_config');
}

/** 写回 ~/.zhuye/config.toml(写盘前校验合法性)。 */
export async function zhuye_save_config(toml: string): Promise<void> {
  return invoke<void>('zhuye_save_config', { toml });
}

/** 读取用户级自定义指令(`<用户数据目录>/AGENTS.md`;不存在 → 空串)。 */
export async function zhuye_get_user_instructions(): Promise<string> {
  return invoke<string>('zhuye_get_user_instructions');
}

/** 保存用户级自定义指令(原子写;与会话首轮注入同源,对所有会话生效)。 */
export async function zhuye_save_user_instructions(content: string): Promise<void> {
  return invoke<void>('zhuye_save_user_instructions', { content });
}

/**
 * 运行中切换模型 / 钉住组内凭据(热重载模型栈,下一个 turn 生效)。
 *
 * `group` = **模型组 id**(`[[model_group]]` 的 id)—— 配置里只剩「模型组」
 * 一层,组 id 才是接入目标(不再是 provider 名):
 * - 写 `[active].group` = 组 id;
 * - `model` 写组级默认模型(spec = `<组id>/<model>`)。
 *
 * `label` = 组内被钉住的凭据(`[[model_group.credentials]]` 的 label):
 * - 传非空:写入 `[active].credential` 钉住该凭据(model 写入条目自身);
 * - 传 `undefined` / '' :不钉凭据,model 写组级。
 * `model` 传空串 = 清除对应位置的 model 覆盖。
 *
 * 返回解析后的完整 spec(如 `demo/gpt-4o`);无任何显式 model 时返回
 * 空串(后端不再编造内置默认,由 UI 如实显示"未配置模型")。
 */
export async function zhuye_set_model(
  group: string,
  model: string,
  label?: string,
): Promise<string> {
  return invoke<string>('zhuye_set_model', { group, model, label: label ?? '' });
}

/** 列出当前 ToolRegistry 中所有工具(name + description)。 */
export async function zhuye_list_tools(): Promise<ZhuyeToolInfo[]> {
  return invoke<ZhuyeToolInfo[]>('zhuye_list_tools');
}

/** coding plan 余量快照 —— 对齐后端 `PlanQuotaSnapshot` / `zhuye_llm::QuotaSnapshot`。 */
export interface PlanQuotaSnapshot {
  /** false = 鉴权/解析/网络失败,原因见 error。 */
  success: boolean;
  error: string | null;
  /** 主窗口已用百分比 0-100(厂商未返回为 null)。 */
  utilization: number | null;
  /** 剩余 token 绝对值(百分比型厂商为 null)。 */
  remaining_tokens: number | null;
  /** 窗口上限 token 绝对值。 */
  max_tokens: number | null;
  /** 窗口重置时间(RFC3339;厂商未返回为 null)。 */
  resets_at: string | null;
}

/**
 * 查询 coding plan 剩余额度(对着厂商用量 API,端点与 cc-switch 一致)。
 * `checkVia` = plan 配置的 `quota.check_via`(kimi / zhipu / minimax / zenmux);
 * 传显式 baseUrl/apiKey,编辑中未保存的表单也能直接试查。
 */
export async function zhuye_query_plan_quota(
  base_url: string,
  api_key: string,
  check_via: string,
): Promise<PlanQuotaSnapshot> {
  return invoke<PlanQuotaSnapshot>('zhuye_query_plan_quota', {
    baseUrl: base_url,
    apiKey: api_key,
    checkVia: check_via,
  });
}
