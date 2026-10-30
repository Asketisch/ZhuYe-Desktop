/**
 * i18n 命名空间 —— files.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const files: Record<string, StringEntry> = {
  'files.title':              { en: 'Files',                                               'zh-CN': '文件' },
  'files.subtitle':           { en: 'Browse and edit workspace files (CodeMirror). Agent edits show as green/red hunks with accept/reject.', 'zh-CN': '浏览并编辑工作区文件(CodeMirror)。agent 的修改以绿/红变更块呈现,支持逐块接受或拒绝恢复。' },
  'files.pendingChanges':     { en: '{count} pending change{plural} from agent',           'zh-CN': 'agent 有 {count} 处待确认变更' },
  'files.acceptAll':          { en: 'Accept all',                                          'zh-CN': '全部接受' },
  'files.rejectAll':          { en: 'Reject all',                                          'zh-CN': '全部拒绝' },
  'files.rejectFailed':       { en: 'Reject failed — the hunk no longer matches the file content. Review manually.', 'zh-CN': '拒绝失败——变更块与当前文件内容不匹配,请手动检查。' },
  'files.truncatedReadOnly':  { en: 'This file is too large to show in full. The preview is read-only and changes cannot be reviewed here.', 'zh-CN': '文件过大，无法完整显示。此预览为只读，不能在此审核变更。' },
  'files.binary':             { en: 'Binary file — content not shown.',                    'zh-CN': '二进制文件,不显示内容。' },
  'files.lspUnavailable':     { en: 'LSP could not be enabled. Check the language server configuration.', 'zh-CN': '无法启用 LSP，请检查语言服务配置。' },
  'files.lspOff':             { en: 'LSP off',                                             'zh-CN': 'LSP 未开启' },
  'files.lspOn':              { en: 'LSP on ({count} servers)',                            'zh-CN': 'LSP 已开启({count} 个服务)' },
  'files.lspOffHint':         { en: 'Enable LSP for this workspace? It starts language servers (higher tooling accuracy for the agent), at the cost of system resources.', 'zh-CN': '为当前工作区开启 LSP?将启动语言服务,agent 的代码理解(定义/引用/诊断)更准确,但会增加系统资源占用。' },
  'files.lspOnHint':          { en: 'LSP enabled — files are warmed up as you open them. Click to disable.', 'zh-CN': 'LSP 已开启——打开文件时会自动预热建立索引。点击关闭。' },
  // LSP 诊断(Problems)
  'files.problems.title':     { en: 'Problems',                                           'zh-CN': '问题' },
  'files.problems.empty':     { en: 'No diagnostics for this file.',                     'zh-CN': '该文件暂无诊断。' },
  'files.problems.at':        { en: 'Ln {line}, Col {col}',                             'zh-CN': '第 {line} 行 第 {col} 列' },
  'files.open':               { en: 'Open',                                                'zh-CN': '打开' },
  'files.refresh':            { en: 'Refresh',                                             'zh-CN': '刷新' },
  'files.empty':              { en: 'empty',                                               'zh-CN': '空' },
  'files.noFile':             { en: 'No file selected',                                    'zh-CN': '未选择文件' },
  'files.noFileDesc':         { en: 'Pick a file from the tree on the left to preview its contents.', 'zh-CN': '从左侧文件树中选择一个文件以预览其内容。' },
  'files.loadingFile':        { en: 'Loading {name}…',                                     'zh-CN': '正在加载 {name}…' },
  'files.search.placeholder': { en: 'Search in workspace…',                                'zh-CN': '在工作区搜索…' },
  'files.search.resultCount': { en: '{count} result{plural}',                              'zh-CN': '{count} 个结果' },
  'files.search.empty':       { en: 'No matches',                                          'zh-CN': '没有匹配项' },
  'files.editor.copied':      { en: 'Copied to clipboard',                                 'zh-CN': '已复制到剪贴板' },
  'files.editor.readonly':    { en: 'Read-only',                                           'zh-CN': '只读' },
  'files.editor.save':        { en: 'Save',                                                'zh-CN': '保存' },
  'files.editor.unsaved':     { en: 'Unsaved changes',                                     'zh-CN': '未保存的改动' },
  'files.editor.conflict':    { en: 'The file changed on disk. Discard the draft to reload it.', 'zh-CN': '磁盘上的文件已变化，可丢弃草稿并重新读取。' },
  'files.editor.saveFailed':  { en: 'Could not save: {msg}',                               'zh-CN': '保存失败：{msg}' },
  'files.editor.discard':     { en: 'Discard changes',                                   'zh-CN': '丢弃改动' },
  'files.editor.reload':      { en: 'Reload file',                                       'zh-CN': '重新读取' },
  'files.editor.diskChanged': { en: 'The file changed on disk. Reload it before rejecting.', 'zh-CN': '磁盘上的文件已变化，请重新读取后再拒绝变更。' },
  'files.editor.reloadFailed': { en: 'Could not reload: {msg}',                           'zh-CN': '重新读取失败：{msg}' },
  'files.editor.exceedsLimit': { en: 'File too large to edit (>{kb} KB)',                  'zh-CN': '文件过大,无法编辑 (>{kb} KB)' },
  'files.findInFiles':        { en: 'Find in files',                                       'zh-CN': '在文件中查找' },
  'files.findInFilesSubtitle': { en: 'Search file contents across the active workspace. Skips .git, node_modules, target, dist, build.', 'zh-CN': '在活动工作区中搜索文件内容。跳过 .git, node_modules, target, dist, build。' },
  'files.findPlaceholder':    { en: 'Type to search…',                                     'zh-CN': '输入搜索…' },
  'files.findSearching':      { en: 'Searching…',                                          'zh-CN': '搜索中…' },
  'files.findFailed':         { en: 'Search failed',                                       'zh-CN': '搜索失败' },
  'files.findNoMatches':      { en: 'No matches',                                          'zh-CN': '没有匹配' },
  'files.findNoMatchesDesc':  { en: 'No files contain "{query}".',                         'zh-CN': '没有文件包含 "{query}"。' },
  'files.findHits':           { en: '{count} hit{plural}',                                 'zh-CN': '{count} 个匹配' },
  'files.findTruncated':      { en: 'truncated at 200',                                    'zh-CN': '截断于 200 条' },
  'search.tab.sessions':      { en: 'Sessions',                                            'zh-CN': '会话' },
  'search.tab.files':         { en: 'Files',                                               'zh-CN': '文件' },
  // 搜索排序方式
  'search.rank.substring':    { en: 'substring',                                          'zh-CN': '子串' },
  'search.rank.substringHint':{ en: 'Substring match (fast).',                             'zh-CN': '子串匹配（快）。' },
  'search.rank.bm25Hint':     { en: 'BM25 relevance ranking — same as the agent grep tool.', 'zh-CN': 'BM25 相关性排序 —— 与 agent 的 grep 工具同款。' },
  'search.sessionHits':       { en: '{count} session{plural}',                             'zh-CN': '{count} 个会话' },
};

export default files;
