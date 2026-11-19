/**
 * 模型 spec 展示判定（StatusBar / TitleBar 共用）。
 *
 * model 解析诚实化后，provider 或 model 缺失时 GUI 后端仍以 `stub/test`
 * 占位 spec 构造线程（请求会失败并给出明确错误），`session_configured`
 * 事件会把该占位原样带出。展示层据此隐藏占位、回落到 agent_status 的
 * `has_model` 判定，最终显示「未配置模型」而非一个假的模型名。
 */
export const STUB_MODEL_SPEC = 'stub/test';

export function isUsableModelSpec(model?: string | null): boolean {
  return Boolean(model) && model !== STUB_MODEL_SPEC;
}
