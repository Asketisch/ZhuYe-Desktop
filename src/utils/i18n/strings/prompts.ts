/**
 * i18n 命名空间 —— prompts.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const prompts: Record<string, StringEntry> = {
  'prompts.title':     { en: 'Prompts',                     'zh-CN': '提示词' },
  'prompts.subtitle':  { en: 'Reusable prompt templates.',  'zh-CN': '可复用的提示词模板。' },
  'prompts.empty':     { en: 'No prompts yet.',             'zh-CN': '暂无提示词。' },
  'prompts.new':       { en: 'New prompt',                  'zh-CN': '新建提示词' },
  'prompts.copy':      { en: 'Copy to clipboard',           'zh-CN': '复制到剪贴板' },
  'prompts.insert':    { en: 'Insert into composer',        'zh-CN': '插入到输入框' },
  // v1.6.1：提示词层（per-model prompt library）弹窗
  'promptLayers.title':          { en: 'Prompt selection',                               'zh-CN': '提示词选择' },
  'promptLayers.currentSpec':    { en: 'Current model',                                  'zh-CN': '当前模型' },
  'promptLayers.activeLayers':   { en: 'Active layers',                                  'zh-CN': '生效层' },
  'promptLayers.availableLayers':{ en: 'Available layers',                               'zh-CN': '可用层' },
  'promptLayers.none':           { en: 'None',                                           'zh-CN': '无' },
  'promptLayers.rescan':         { en: 'Rescan',                                         'zh-CN': '重新扫描' },
  'promptLayers.effectiveBody':   { en: 'Effective prompt',                               'zh-CN': '生效的提示词' },
  'promptLayers.noBody':          { en: 'No prompt section resolved for this model.',      'zh-CN': '当前模型未解析出提示词段落。' },
  'promptLayers.hint':           { en: 'Edit .zhuye/prompts/*.md and rescan to update available profiles.', 'zh-CN': '修改 .zhuye/prompts/*.md 后重新扫描即可更新可选方案。' },
  'promptLayers.mode':           { en: 'Selection', 'zh-CN': '选择模式' },
  'promptLayers.default':        { en: 'ZhuYe default', 'zh-CN': 'ZhuYe 默认' },
  'promptLayers.auto':           { en: 'Automatic', 'zh-CN': '智能选择' },
  'promptLayers.manual':         { en: 'Manual profile', 'zh-CN': '手动选择' },
  'promptLayers.effectiveProfile': { en: 'Effective profile', 'zh-CN': '生效方案' },
  'promptLayers.saveDefault':    { en: 'Save as default', 'zh-CN': '保存为默认' },
  'promptLayers.followDefault':  { en: 'Follow default', 'zh-CN': '跟随默认' },
};

export default prompts;
