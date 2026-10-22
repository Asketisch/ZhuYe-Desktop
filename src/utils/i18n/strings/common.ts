/**
 * i18n 命名空间 —— common.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const common: Record<string, StringEntry> = {
  'common.close':     { en: 'Close',              'zh-CN': '关闭' },
  'common.cancel':    { en: 'Cancel',             'zh-CN': '取消' },
  'common.visionTag': { en: 'vision',         'zh-CN': '支持视觉' },
  'common.noVisionTag': { en: 'no vision',     'zh-CN': '不支持视觉' },
  'common.freeTag': { en: 'free',           'zh-CN': '免费' },
  'common.confirm':   { en: 'Confirm',            'zh-CN': '确认' },
  'common.save':      { en: 'Save',               'zh-CN': '保存' },
  'common.show':      { en: 'Show',               'zh-CN': '显示' },
  'common.hide':      { en: 'Hide',               'zh-CN': '隐藏' },
  'common.showKey':   { en: 'Show key',           'zh-CN': '显示密钥' },
  'common.hideKey':   { en: 'Hide key',           'zh-CN': '隐藏密钥' },
  'common.copy':      { en: 'Copy',               'zh-CN': '复制' },
  'common.copied':    { en: 'Copied',             'zh-CN': '已复制' },
  'common.clear':     { en: 'Clear',              'zh-CN': '清空' },
  'common.apply':     { en: 'Apply',              'zh-CN': '应用' },
  'common.reset':     { en: 'Reset',              'zh-CN': '恢复默认' },
  'common.remove':    { en: 'Remove',             'zh-CN': '移除' },
  'common.add':       { en: 'Add',                'zh-CN': '添加' },
  'common.refresh':   { en: 'Refresh',            'zh-CN': '刷新' },
  'common.search':    { en: 'Search',             'zh-CN': '搜索' },
  'common.loading':   { en: 'Loading…',           'zh-CN': '加载中…' },
  'common.empty':     { en: 'Nothing here yet.',  'zh-CN': '暂无内容。' },
  'common.retry':     { en: 'Retry',              'zh-CN': '重试' },
  'common.delete':    { en: 'Delete',             'zh-CN': '删除' },
  'common.rename':    { en: 'Rename',             'zh-CN': '重命名' },
  'common.export':    { en: 'Export',             'zh-CN': '导出' },
  'common.open':      { en: 'Open',               'zh-CN': '打开' },
  'common.yes':       { en: 'Yes',                'zh-CN': '是' },
  'common.no':        { en: 'No',                 'zh-CN': '否' },
  'common.ok':        { en: 'OK',                 'zh-CN': '确定' },
  'common.other':     { en: 'Other',              'zh-CN': '其他' },
  'common.advanced':  { en: 'Advanced',           'zh-CN': '高级' },
  'common.back':      { en: 'Back',               'zh-CN': '返回' },
  'common.next':      { en: 'Next',               'zh-CN': '下一步' },
  'common.done':      { en: 'Done',               'zh-CN': '完成' },
  'common.error':     { en: 'Error',              'zh-CN': '错误' },
  'common.warning':   { en: 'Warning',            'zh-CN': '警告' },
  'common.info':      { en: 'Info',               'zh-CN': '提示' },
  'common.success':   { en: 'Success',            'zh-CN': '成功' },
};

export default common;
