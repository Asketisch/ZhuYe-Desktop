/**
 * KMS —— 知识管理系统视图。
 *
 * Phase 3 条目 12：基于 grep 的 wiki + /dream 会话挖掘。
 * 列出知识库，支持创建/编辑/搜索页面。
 */
import { useEffect, useState } from 'react';
import { BookOpen, Plus, Search, Trash2, FileText } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Button, EmptyState, Spinner, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { confirmDialog } from '@/features/modals/ConfirmDialog';
import {
  reflect_kms_list,
  reflect_kms_create,
  reflect_kms_delete,
  reflect_kms_list_pages,
  reflect_kms_save_page,
  reflect_kms_search,
  type ReflectWikiInfo,
  type ReflectPage,
  type ReflectSearchResult,
} from '@/utils/commands';
import s from './KmsView.module.css';

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message || null;
  if (typeof error === 'string') return error || null;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg || null;
  return null;
}

export function KmsView() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [selectedWiki, setSelectedWiki] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWikiName, setNewWikiName] = useState('');
  const [newWikiDesc, setNewWikiDesc] = useState('');
  // 搜索输入与查询分离：防抖后才触发跨 wiki grep，避免每个按键一次后端请求。
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPage, setEditingPage] = useState<ReflectPage | null>(null);
  const [pageContent, setPageContent] = useState('');
  const [pageName, setPageName] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const wikisQuery = useQuery({
    queryKey: ['kms', 'wikis'],
    queryFn: reflect_kms_list,
  });

  const pagesQuery = useQuery({
    queryKey: ['kms', 'pages', selectedWiki],
    queryFn: () => reflect_kms_list_pages(selectedWiki!),
    enabled: !!selectedWiki,
  });

  const searchResults = useQuery({
    queryKey: ['kms', 'search', searchQuery],
    queryFn: () => reflect_kms_search(searchQuery),
    enabled: searchQuery.length > 1,
  });

  const createWiki = useMutation({
    mutationFn: () => reflect_kms_create(newWikiName, newWikiDesc || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] });
      setShowCreateForm(false);
      setNewWikiName('');
      setNewWikiDesc('');
    },
  });

  const deleteWiki = useMutation({
    mutationFn: (name: string) => reflect_kms_delete(name),
    onSuccess: (_result, name) => {
      queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] });
      queryClient.invalidateQueries({ queryKey: ['kms', 'pages', name] });
      queryClient.invalidateQueries({ queryKey: ['kms', 'search'] });
      if (selectedWiki === name) setSelectedWiki(null);
    },
  });

  const savePage = useMutation({
    mutationFn: ({ wiki, name, content, createOnly, expectedContent }: { wiki: string; name: string; content: string; createOnly: boolean; expectedContent?: string }) =>
      reflect_kms_save_page(wiki, name, content, null, null, createOnly, expectedContent),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['kms', 'pages', variables.wiki] });
      queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] });
      queryClient.invalidateQueries({ queryKey: ['kms', 'search'] });
      setEditingPage(null);
      setPageContent('');
      setPageName('');
    },
  });

  return (
    <PageShell
      icon={BookOpen}
      title={t('kms.title')}
      subtitle={t('kms.subtitle')}
      width="lg"
    >
      {/* Search bar */}
      <Card level="flat" padding="md" className={s.searchCard}>
        <div className={s.searchRow}>
          <Icon icon={Search} size={16} />
          <Input
            placeholder={t('kms.searchPlaceholder')}
            value={searchInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
            className={s.searchInput}
          />
        </div>
        {searchResults.data && searchResults.data.length > 0 && (
          <div className={s.searchResults}>
            {searchResults.data.map((r: ReflectSearchResult, i: number) => (
              <div key={i} className={s.searchItem}>
                <Badge variant="info">{r.wiki}/{r.page}</Badge>
                <span className={s.snippet}>{r.lines[0]}</span>
              </div>
            ))}
          </div>
        )}
        {searchResults.isError && <p role="alert">{t('kms.searchFailed')} {errorMessage(searchResults.error)}</p>}
      </Card>

      {/* Wiki selector */}
      <div className={s.wikiBar}>
        {wikisQuery.data?.map((wiki: ReflectWikiInfo) => (
          <button
            key={wiki.name}
            type="button"
            className={s.wikiTab}
            data-active={selectedWiki === wiki.name || undefined}
            disabled={deleteWiki.isPending || (editingPage !== null && selectedWiki !== wiki.name)}
            onClick={() => setSelectedWiki(wiki.name)}
          >
            {wiki.name}
            <Badge variant="neutral">{wiki.pageCount}</Badge>
          </button>
        ))}
        <Button variant="ghost" size="sm" disabled={createWiki.isPending} onClick={() => { createWiki.reset(); setShowCreateForm(!showCreateForm); }}>
          <Icon icon={Plus} size={14} /> {t('kms.new')}
        </Button>
      </div>

      {/* Create wiki form */}
      {showCreateForm && (
        <Card level="outlined" padding="md" className={s.createForm}>
          <Input
            placeholder={t('kms.wikiNamePlaceholder')}
            value={newWikiName}
            disabled={createWiki.isPending}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewWikiName(e.target.value)}
          />
          <Input
            placeholder={t('kms.descriptionPlaceholder')}
            value={newWikiDesc}
            disabled={createWiki.isPending}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewWikiDesc(e.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => createWiki.mutate()}
            disabled={!newWikiName || createWiki.isPending}
          >
            {t('kms.create')}
          </Button>
          {createWiki.isError && <p role="alert">{t('kms.createFailed')} {errorMessage(createWiki.error)}</p>}
        </Card>
      )}

      {wikisQuery.isError && <p role="alert">{t('kms.listFailed')} {errorMessage(wikisQuery.error)}</p>}

      {/* Selected wiki content */}
      {selectedWiki ? (
        <div className={s.wikiContent}>
          <div className={s.wikiHeader}>
            <h2 className={s.wikiTitle}>{selectedWiki}</h2>
            <div className={s.wikiActions}>
              <Button
                variant="ghost"
                size="sm"
                disabled={editingPage !== null || deleteWiki.isPending}
                onClick={() => {
                  savePage.reset();
                  setEditingPage({
                    name: '',
                    content: '',
                    tags: [],
                    wiki: selectedWiki ?? '',
                    title: null,
                    modifiedAtMs: 0,
                  });
                  setPageName('');
                  setPageContent('');
                }}
              >
                <Icon icon={Plus} size={14} /> {t('kms.newPage')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={editingPage !== null || deleteWiki.isPending}
                onClick={async () => {
                  // remove_dir_all 级别的破坏性操作，必须二次确认。
                  const ok = await confirmDialog({
                    title: t('kms.deleteWiki'),
                    message: t('kms.deleteWikiConfirm', { name: selectedWiki }),
                  });
                  if (ok) deleteWiki.mutate(selectedWiki);
                }}
              >
                <Icon icon={Trash2} size={14} /> {t('kms.deleteWiki')}
              </Button>
            </div>
          </div>

          {deleteWiki.isError && deleteWiki.variables === selectedWiki && <p role="alert">{t('kms.deleteFailed')} {errorMessage(deleteWiki.error)}</p>}

          {editingPage !== null && (
            <Card level="outlined" padding="md" className={s.editorCard}>
              <Input
                placeholder={t('kms.pageNamePlaceholder')}
                value={pageName}
                disabled={savePage.isPending}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPageName(e.target.value)}
              />
              <textarea
                className={s.editor}
                placeholder={t('kms.pageContentPlaceholder')}
                value={pageContent}
                disabled={savePage.isPending}
                onChange={(e) => setPageContent(e.target.value)}
                rows={10}
              />
              <div className={s.editorActions}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => savePage.mutate({ wiki: editingPage.wiki, name: pageName, content: pageContent, createOnly: pageName !== editingPage.name, expectedContent: pageName === editingPage.name ? editingPage.content : undefined })}
                  disabled={!pageName || savePage.isPending}
                >
                  {t('common.save')}
                </Button>
                <Button variant="ghost" size="sm" disabled={savePage.isPending} onClick={() => { savePage.reset(); setEditingPage(null); }}>
                  {t('common.cancel')}
                </Button>
              </div>
              {savePage.isError && <p role="alert"><span>{t('kms.saveFailed')}</span> {errorMessage(savePage.error)}</p>}
            </Card>
          )}

          {pagesQuery.isError && <p role="alert">{t('kms.pagesFailed')} {errorMessage(pagesQuery.error)}</p>}
          {pagesQuery.isLoading ? (
            <Spinner size={20} />
          ) : pagesQuery.data?.length === 0 ? (
            <EmptyState
              icon={<Icon icon={FileText} />}
              title={t('kms.noPages')}
              description={t('kms.noPagesDesc')}
            />
          ) : (
            <div className={s.pageList}>
              {pagesQuery.data?.map((page: ReflectPage) => (
                <Card
                  key={page.name}
                  level="outlined"
                  padding="md"
                  className={s.pageCard}
                  role="button"
                  tabIndex={editingPage === null ? 0 : -1}
                  aria-disabled={editingPage !== null}
                  title={t('kms.editPage')}
                  onClick={() => {
                    if (editingPage !== null) return;
                    savePage.reset();
                    setEditingPage(page);
                    setPageName(page.name);
                    setPageContent(page.content);
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (editingPage !== null) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      savePage.reset();
                      setEditingPage(page);
                      setPageName(page.name);
                      setPageContent(page.content);
                    }
                  }}
                >
                  <div className={s.pageHeader}>
                    <Icon icon={FileText} size={16} />
                    <span className={s.pageName}>{page.name}</span>
                    {page.tags.map((tag) => (
                      <Badge key={tag} variant="neutral">{tag}</Badge>
                    ))}
                  </div>
                  <pre className={s.pageContent}>{page.content.slice(0, 200)}</pre>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : wikisQuery.data?.length === 0 ? (
        <EmptyState
          icon={<Icon icon={BookOpen} />}
          title={t('kms.noWikis')}
          description={t('kms.noWikisDesc')}
        />
      ) : wikisQuery.isLoading ? (
        <Spinner size={20} />
      ) : null}
    </PageShell>
  );
}
