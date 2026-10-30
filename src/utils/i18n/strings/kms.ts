/**
 * i18n 命名空间 - kms.*
 */
import type { StringEntry } from '../types';

const kms: Record<string, StringEntry> = {
  'kms.title':                   { en: 'Knowledge Base', 'zh-CN': '知识库' },
  'kms.subtitle':                { en: 'Grep-based wiki for local knowledge. Create, search, and manage pages.', 'zh-CN': '基于 grep 的本地知识 wiki。创建、搜索并管理页面。' },
  'kms.searchPlaceholder':       { en: 'Search across all knowledge bases...', 'zh-CN': '搜索所有知识库…' },
  'kms.new':                     { en: 'New', 'zh-CN': '新建' },
  'kms.wikiNamePlaceholder':     { en: 'Wiki name (e.g. engineering)', 'zh-CN': 'Wiki 名称 (如 engineering)' },
  'kms.descriptionPlaceholder':  { en: 'Description (optional)', 'zh-CN': '描述 (选填)' },
  'kms.create':                  { en: 'Create', 'zh-CN': '创建' },
  'kms.newPage':                 { en: 'New Page', 'zh-CN': '新建页面' },
  'kms.deleteWiki':              { en: 'Delete Wiki', 'zh-CN': '删除 Wiki' },
  'kms.deleteWikiConfirm':       { en: 'Delete wiki "{name}"?\nThis removes all its pages permanently.', 'zh-CN': '删除 Wiki "{name}"？\n这将永久移除其中的所有页面。' },
  'kms.editPage':                { en: 'Click to edit this page.', 'zh-CN': '点击编辑该页面。' },
  'kms.saveFailed':              { en: 'Failed to save the page. Your draft is still available.', 'zh-CN': '保存页面失败，草稿仍保留。' },
  'kms.createFailed':            { en: 'Failed to create the knowledge base.', 'zh-CN': '创建知识库失败。' },
  'kms.deleteFailed':            { en: 'Failed to delete the knowledge base.', 'zh-CN': '删除知识库失败。' },
  'kms.listFailed':              { en: 'Failed to load knowledge bases.', 'zh-CN': '加载知识库失败。' },
  'kms.pagesFailed':             { en: 'Failed to load pages.', 'zh-CN': '加载页面失败。' },
  'kms.searchFailed':            { en: 'Search failed.', 'zh-CN': '搜索失败。' },
  'kms.pageNamePlaceholder':     { en: 'Page name (e.g. api-design)', 'zh-CN': '页面名称 (如 api-design)' },
  'kms.pageContentPlaceholder':  { en: 'Write your page content in Markdown...', 'zh-CN': '用 Markdown 撰写页面内容…' },
  'kms.noPages':                 { en: 'No pages yet', 'zh-CN': '暂无页面' },
  'kms.noPagesDesc':             { en: 'Create a new page to start building your knowledge base.', 'zh-CN': '创建一个新页面，开始构建你的知识库。' },
  'kms.noWikis':                 { en: 'No knowledge bases', 'zh-CN': '暂无知识库' },
  'kms.noWikisDesc':             { en: 'Create your first wiki to start organizing knowledge.', 'zh-CN': '创建你的第一个 Wiki，开始整理知识。' },
} as const;

export default kms;
