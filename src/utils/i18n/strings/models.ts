/**
 * i18n 命名空间 —— models.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 *
 * 术语口径：配置里只剩「模型组」一层（组 id 才是接入目标），文案不再
 * 用 provider / coding plan 表述。
 */
import type { StringEntry } from '../types';

const models: Record<string, StringEntry> = {
  'models.title':              { en: 'Models',                                                   'zh-CN': '模型' },
  'models.subtitle':           { en: 'Available models across active model groups.',             'zh-CN': '当前模型组可用的模型。' },
  'models.empty':              { en: 'No models available — check model group config.',          'zh-CN': '没有可用模型——请检查模型组配置。' },
  'models.context':            { en: 'Context window: {tokens} tokens',                          'zh-CN': '上下文窗口: {tokens} tokens' },
  'models.pricing':            { en: 'Pricing: in {in} / out {out} (micro-USD/Mtok)',            'zh-CN': '价格: 输入 {in} / 输出 {out} (micro-USD/Mtok)' },
  'models.currentModel':       { en: 'Current model',                                            'zh-CN': '当前模型' },
  'models.effort':             { en: 'Reasoning effort',                                         'zh-CN': '推理 effort' },
  'models.effortHint':         { en: 'Switch effort via Op::SetEffort for the active session.',  'zh-CN': '通过 Op::SetEffort 切换当前会话的 effort。' },
  'models.applied':            { en: 'Applied ✓',                                                'zh-CN': '已应用 ✓' },
  'models.applyEffort':        { en: 'Apply effort',                                             'zh-CN': '应用 effort' },
  'models.effort.lowDesc':     { en: 'Fastest · minimal reasoning',                              'zh-CN': '最快 · 最少推理' },
  'models.effort.mediumDesc':  { en: 'Balanced (recommended)',                                   'zh-CN': '平衡 (推荐)' },
  'models.effort.highDesc':    { en: 'Deep · slowest',                                           'zh-CN': '深度推理 · 最慢' },
  'models.effort.maxDesc':     { en: 'Maximum · model-clamped',                                  'zh-CN': '最大档 · 按模型钳制' },
  'models.effort.ultraDesc':   { en: 'Ultra · model-clamped',                                    'zh-CN': 'Ultra 档 · 按模型钳制' },
  'models.noGroup':            { en: 'No model group configured',                                'zh-CN': '未配置模型组' },
  'models.noGroupDesc':        { en: 'Set an API key on a model group to enable a model.',        'zh-CN': '在模型组上设置 API 密钥以启用模型。' },
  'models.configureHint':      { en: 'Configure one in Settings to get started.',                'zh-CN': '请在设置中配置。' },
  'models.settingsHint':       { en: 'Model spec is edited in Settings → {path}.',               'zh-CN': '模型规范在 Settings → {path} 中编辑。' },

  // 模型组（组 id 才是接入目标；组内凭据可在输入框的模型选择器中钉住）
  'models.groups':             { en: 'Model groups',                                             'zh-CN': '模型组' },
  'models.groupsEmpty':        { en: 'No model groups configured — add one in Settings.',        'zh-CN': '暂无模型组 — 在 设置 中添加。' },
  'models.groupIsDefault':     { en: 'Default',                                                  'zh-CN': '当前默认' },
  'models.groupSetDefault':    { en: 'Set as default',                                           'zh-CN': '设为默认' },
  'models.groupCredentials':   { en: '{count} credential(s)',                                    'zh-CN': '{count} 条凭据' },
  'models.groupsHint':         { en: 'Switching the default model group hot-reloads the current session — no restart needed. Credentials inside a group can be pinned from the model picker.', 'zh-CN': '切换默认模型组后当前会话热重载,无需重启;组内凭据可在输入框的模型选择器中钉住。' },
};

export default models;
