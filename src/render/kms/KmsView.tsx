import { BookOpen, Plus, Search, Trash2, FileText } from 'lucide-react';
import type { KmsViewProps, ZhuyePage, ZhuyeSearchResult, ZhuyeWikiInfo } from '@/contracts/kms';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Icon } from '../design-system/Icon';
import { Button } from '../design-system/Button';
import { EmptyState } from '../design-system/EmptyState';
import { Spinner } from '../design-system/Spinner';
import { Input } from '../design-system/Input';
import s from './KmsView.module.css';

export function KmsView({ t, ctrl }: KmsViewProps) {
  const { selectedWiki, setSelectedWiki, showCreateForm, toggleCreateForm, newWikiName, setNewWikiName,
    newWikiDesc, setNewWikiDesc, searchInput, setSearchInput, editingPage, setEditingPage,
    pageName, setPageName, pageContent, setPageContent, wikisQuery, pagesQuery, searchResults,
    createWiki, deleteWiki, savePage, errorMessage } = ctrl;
  const setShowCreateForm = (_value: boolean) => toggleCreateForm();
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
            {searchResults.data.map((r: ZhuyeSearchResult, i: number) => (
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
        {wikisQuery.data?.map((wiki: ZhuyeWikiInfo) => (
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
                onClick={() => { void ctrl.deleteSelectedWiki(); }}
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
              {pagesQuery.data?.map((page: ZhuyePage) => (
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
