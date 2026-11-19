import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reflect_kms_list, reflect_kms_create, reflect_kms_delete, reflect_kms_list_pages, reflect_kms_save_page, reflect_kms_search, type ReflectPage } from '@/utils/commands';
import { confirmDialog } from '@/logic/modals/confirm';
import { useI18n } from '@/utils/i18n';

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message || null;
  if (typeof error === 'string') return error || null;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg || null;
  return null;
}

export function useKmsController() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [selectedWiki, setSelectedWiki] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWikiName, setNewWikiName] = useState('');
  const [newWikiDesc, setNewWikiDesc] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPage, setEditingPage] = useState<ReflectPage | null>(null);
  const [pageContent, setPageContent] = useState('');
  const [pageName, setPageName] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearchQuery(searchInput), 200); return () => clearTimeout(timer); }, [searchInput]);
  const wikisQuery = useQuery({ queryKey: ['kms', 'wikis'], queryFn: reflect_kms_list });
  const pagesQuery = useQuery({ queryKey: ['kms', 'pages', selectedWiki], queryFn: () => reflect_kms_list_pages(selectedWiki!), enabled: !!selectedWiki });
  const searchResults = useQuery({ queryKey: ['kms', 'search', searchQuery], queryFn: () => reflect_kms_search(searchQuery), enabled: searchQuery.length > 1 });
  const createWiki = useMutation({ mutationFn: () => reflect_kms_create(newWikiName, newWikiDesc || null), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] }); setShowCreateForm(false); setNewWikiName(''); setNewWikiDesc(''); } });
  const deleteWiki = useMutation({ mutationFn: (name: string) => reflect_kms_delete(name), onSuccess: (_result, name) => { void queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] }); void queryClient.invalidateQueries({ queryKey: ['kms', 'pages', name] }); void queryClient.invalidateQueries({ queryKey: ['kms', 'search'] }); if (selectedWiki === name) setSelectedWiki(null); } });
  const savePage = useMutation({ mutationFn: ({ wiki, name, content, createOnly, expectedContent }: { wiki: string; name: string; content: string; createOnly: boolean; expectedContent?: string }) => reflect_kms_save_page(wiki, name, content, null, null, createOnly, expectedContent), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['kms', 'pages', selectedWiki] }); void queryClient.invalidateQueries({ queryKey: ['kms', 'wikis'] }); void queryClient.invalidateQueries({ queryKey: ['kms', 'search'] }); setEditingPage(null); setPageContent(''); setPageName(''); } });
  const newPage = () => { savePage.reset(); setEditingPage({ name: '', content: '', tags: [], wiki: selectedWiki ?? '', title: null, modifiedAtMs: 0 }); setPageName(''); setPageContent(''); };
  const editPage = (page: ReflectPage) => { if (editingPage) return; savePage.reset(); setEditingPage(page); setPageName(page.name); setPageContent(page.content); };
  const saveCurrentPage = () => { if (!editingPage) return; savePage.mutate({ wiki: editingPage.wiki, name: pageName, content: pageContent, createOnly: pageName !== editingPage.name, expectedContent: pageName === editingPage.name ? editingPage.content : undefined }); };
  const deleteSelectedWiki = async () => { if (!selectedWiki) return; const ok = await confirmDialog({ title: t('kms.deleteWiki'), message: t('kms.deleteWikiConfirm', { name: selectedWiki }) }); if (ok) deleteWiki.mutate(selectedWiki); };
  return { selectedWiki, setSelectedWiki, showCreateForm, toggleCreateForm: () => { createWiki.reset(); setShowCreateForm((v) => !v); }, newWikiName, setNewWikiName, newWikiDesc, setNewWikiDesc, searchInput, setSearchInput, searchQuery, editingPage, setEditingPage, pageContent, setPageContent, pageName, setPageName, wikisQuery, pagesQuery, searchResults, createWiki, deleteWiki, savePage, newPage, editPage, saveCurrentPage, deleteSelectedWiki, errorMessage };
}

export type KmsController = ReturnType<typeof useKmsController>;
