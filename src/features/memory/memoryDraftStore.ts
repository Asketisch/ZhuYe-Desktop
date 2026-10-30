import { create } from 'zustand';
import type { ReflectMemoryEntry } from '@/utils/commands';

export interface EditDraft {
  entry: ReflectMemoryEntry;
  value: string;
  revision: number;
}

export interface EditSession {
  activeKey: string | null;
  drafts: Record<string, EditDraft>;
}

export interface FormDraft {
  show: boolean;
  scope: 'user' | 'project';
  key: string;
  value: string;
  revision: number;
}

export const emptyForm: FormDraft = { show: false, scope: 'project', key: '', value: '', revision: 0 };
type Drafts<T> = Record<string, T>;
type Update<T> = (drafts: Drafts<T>) => Drafts<T>;

interface MemoryDraftState {
  editSessions: Drafts<EditSession>;
  formDrafts: Drafts<FormDraft>;
  setEditSessions: (update: Update<EditSession>) => void;
  setFormDrafts: (update: Update<FormDraft>) => void;
}

/** 跨页面保留各工作区和代理的未提交草稿。 */
export const useMemoryDraftStore = create<MemoryDraftState>((set) => ({
  editSessions: {},
  formDrafts: {},
  setEditSessions: (update) => set((state) => ({ editSessions: update(state.editSessions) })),
  setFormDrafts: (update) => set((state) => ({ formDrafts: update(state.formDrafts) })),
}));

let revision = 0;
export function nextDraftRevision(): number { return ++revision; }
