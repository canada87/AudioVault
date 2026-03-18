import { create } from 'zustand';
import type { AudioRecord } from '../api/records';

interface AppState {
  selectedRecordId: number | null;
  sideSheetOpen: boolean;
  searchQuery: string;
  statusFilter: string;
  tagFilter: string[];
  tagFilterMode: 'or' | 'and';
  sortBy: string;
  sortOrder: 'asc' | 'desc';

  setSelectedRecord: (id: number | null) => void;
  openSideSheet: (record: AudioRecord) => void;
  closeSideSheet: () => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: string) => void;
  setTagFilter: (tags: string[]) => void;
  setTagFilterMode: (mode: 'or' | 'and') => void;
  setSortBy: (by: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  toggleSortOrder: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedRecordId: null,
  sideSheetOpen: false,
  searchQuery: '',
  statusFilter: '',
  tagFilter: [],
  tagFilterMode: 'or',
  sortBy: 'recorded_at',
  sortOrder: 'desc',

  setSelectedRecord: (id) => set({ selectedRecordId: id }),

  openSideSheet: (record) =>
    set({ selectedRecordId: record.id, sideSheetOpen: true }),

  closeSideSheet: () =>
    set({ sideSheetOpen: false, selectedRecordId: null }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  setTagFilter: (tags) => set({ tagFilter: tags }),
  setTagFilterMode: (mode) => set({ tagFilterMode: mode }),
  setSortBy: (by) => set({ sortBy: by }),
  setSortOrder: (order) => set({ sortOrder: order }),
  toggleSortOrder: () =>
    set((state) => ({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' })),
}));
