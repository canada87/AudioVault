import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, ChevronUp, ChevronDown, Filter, Loader2, X, Play, Volume2, FolderSearch } from 'lucide-react';
import { fetchRecords, triggerTranscribe, scanAudioDirectory } from '../api/records';
import { fetchTags } from '../api/tags';
import type { AudioRecord } from '../api/records';
import StatusBadge from '../components/StatusBadge';
import TagPill from '../components/TagPill';
import DurationDisplay from '../components/DurationDisplay';
import RecordDetail from './RecordDetail';
import { useAppStore } from '../store/useAppStore';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'transcribing', label: 'Transcribing' },
  { value: 'transcribed', label: 'Transcribed' },
  { value: 'processing', label: 'Processing' },
  { value: 'done', label: 'Done' },
  { value: 'error', label: 'Error' },
];

export default function ListView(): React.ReactElement {
  const {
    searchQuery,
    statusFilter,
    tagFilter,
    tagFilterMode,
    sortBy,
    sortOrder,
    selectedRecordId,
    sideSheetOpen,
    setSearchQuery,
    setStatusFilter,
    setTagFilter,
    setTagFilterMode,
    setSortBy,
    setSortOrder,
    openSideSheet,
    closeSideSheet,
  } = useAppStore();

  const queryClient = useQueryClient();
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [page, setPage] = useState(1);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [transcribingBatch, setTranscribingBatch] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ added: number; scanned: number } | null>(null);
  const [tagFilterSearch, setTagFilterSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page and selection on filter change
  useEffect(() => {
    setPage(1);
    setCheckedIds(new Set());
  }, [debouncedSearch, statusFilter, tagFilter, sortBy, sortOrder]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['records', page, debouncedSearch, statusFilter, tagFilter.join(','), tagFilterMode, sortBy, sortOrder],
    queryFn: () =>
      fetchRecords({
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        tags: tagFilter.length > 0 ? tagFilter.join(',') : undefined,
        tagMode: tagFilter.length > 1 ? tagFilterMode : undefined,
        sortBy,
        sortOrder,
      }),
    refetchInterval: 5000,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const handleRowClick = useCallback(
    (record: AudioRecord) => {
      openSideSheet(record);
    },
    [openSideSheet],
  );

  const handleSort = (col: string): void => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
  };

  const toggleTagFilter = (tagId: string): void => {
    setTagFilter(
      tagFilter.includes(tagId)
        ? tagFilter.filter((t) => t !== tagId)
        : [...tagFilter, tagId],
    );
  };

  const renderSortIcon = (col: string): React.ReactElement => {
    if (sortBy !== col) return <ChevronUp className="w-3 h-3 opacity-30" />;
    return sortOrder === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  };

  const pageRecords = data?.data ?? [];
  const allPageIds = pageRecords.map((r) => r.id);
  const allChecked = allPageIds.length > 0 && allPageIds.every((id) => checkedIds.has(id));
  const someChecked = allPageIds.some((id) => checkedIds.has(id));

  const toggleAll = (): void => {
    if (allChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        allPageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        allPageIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const toggleCheck = (id: number, e: React.MouseEvent): void => {
    e.stopPropagation();
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchTranscribe = async (): Promise<void> => {
    setTranscribingBatch(true);
    const ids = [...checkedIds];
    for (const id of ids) {
      try {
        await triggerTranscribe(id);
      } catch (_e) {
        // continue with remaining
      }
    }
    setCheckedIds(new Set());
    setTranscribingBatch(false);
    void queryClient.invalidateQueries({ queryKey: ['records'] });
  };

  const handleScan = async (): Promise<void> => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await scanAudioDirectory();
      setScanResult(result);
      if (result.added > 0) {
        void queryClient.invalidateQueries({ queryKey: ['records'] });
      }
      setTimeout(() => setScanResult(null), 5000);
    } catch (_e) {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className={`flex flex-col flex-1 min-w-0 ${sideSheetOpen ? 'hidden md:flex' : 'flex'}`}>
        {/* Toolbar */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search recordings..."
                className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleScan()}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 transition-colors"
              title="Scan audio folder for new files"
            >
              {scanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderSearch className="w-4 h-4" />
              )}
              Scan
            </button>
          </div>

          {/* Scan result feedback */}
          {scanResult && (
            <div className={`text-sm px-3 py-1.5 rounded-md ${scanResult.added > 0 ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
              {scanResult.added > 0
                ? `Found ${scanResult.added} new recording${scanResult.added > 1 ? 's' : ''} (${scanResult.scanned} files scanned)`
                : `No new recordings found (${scanResult.scanned} files scanned)`}
            </div>
          )}

          {/* Tag filters (grouped by hierarchy) */}
          {allTags.length > 0 && (() => {
            const q = tagFilterSearch.trim().toLowerCase();
            const matches = (name: string): boolean => !q || name.includes(q);

            // Group: roots (parent_id null) carry their children; orphans are treated as roots.
            const rootsById = new Map<number, typeof allTags[number]>();
            allTags.forEach((t) => { if (t.parent_id == null) rootsById.set(t.id, t); });

            const childrenByParent = new Map<number, typeof allTags>();
            allTags.forEach((t) => {
              if (t.parent_id != null && rootsById.has(t.parent_id)) {
                const list = childrenByParent.get(t.parent_id) ?? [];
                list.push(t);
                childrenByParent.set(t.parent_id, list);
              }
            });

            const sortedRoots = [...rootsById.values()].sort((a, b) => a.name.localeCompare(b.name));
            // Orphans (parent_id set but parent not present) → treat as roots too
            const orphans = allTags
              .filter((t) => t.parent_id != null && !rootsById.has(t.parent_id))
              .sort((a, b) => a.name.localeCompare(b.name));

            const renderChip = (tag: typeof allTags[number]): React.ReactElement | null => {
              const selected = tagFilter.includes(String(tag.id));
              if (!matches(tag.name) && !selected) return null;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTagFilter(String(tag.id))}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:border-primary'
                  }`}
                >
                  {tag.name}
                </button>
              );
            };

            const renderGroup = (
              root: typeof allTags[number],
              children: typeof allTags,
            ): React.ReactElement | null => {
              const kidChips = children
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(renderChip)
                .filter((x): x is React.ReactElement => x !== null);
              const rootSelected = tagFilter.includes(String(root.id));
              const rootVisible = matches(root.name) || rootSelected || kidChips.length > 0;
              if (!rootVisible) return null;
              return (
                <div key={root.id} className="flex flex-wrap items-center gap-1.5">
                  {renderChip(root)}
                  {kidChips.length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground/60 mx-0.5">›</span>
                      {kidChips}
                    </>
                  )}
                </div>
              );
            };

            return (
              <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                {allTags.length > 8 && (
                  <input
                    type="text"
                    value={tagFilterSearch}
                    onChange={(e) => setTagFilterSearch(e.target.value)}
                    placeholder="Filter tags..."
                    className="px-2 py-0.5 text-xs rounded-full border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring w-32"
                  />
                )}
                {sortedRoots.map((root) => renderGroup(root, childrenByParent.get(root.id) ?? []))}
                {orphans.map((t) => renderChip(t))}
                {tagFilter.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setTagFilterMode(tagFilterMode === 'or' ? 'and' : 'or')}
                    className="px-2 py-0.5 text-xs rounded-full border font-medium transition-colors bg-secondary text-secondary-foreground border-secondary hover:bg-secondary/80"
                    title={tagFilterMode === 'or' ? 'Showing records with ANY selected tag' : 'Showing records with ALL selected tags'}
                  >
                    {tagFilterMode.toUpperCase()}
                  </button>
                )}
                {tagFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTagFilter([])}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })()}

          {/* Batch action bar */}
          {checkedIds.size > 0 && (
            <div className="flex items-center gap-3 p-2 rounded-md bg-accent border border-border">
              <span className="text-sm text-foreground">{checkedIds.size} selected</span>
              <button
                type="button"
                onClick={() => void handleBatchTranscribe()}
                disabled={transcribingBatch}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {transcribingBatch ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Transcribe selected
              </button>
              <button
                type="button"
                onClick={() => setCheckedIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                      onChange={toggleAll}
                      className="rounded border-input cursor-pointer"
                    />
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort('recorded_at')}
                    >
                      Date/Time {renderSortIcon('recorded_at')}
                    </button>
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort('original_name')}
                    >
                      Name {renderSortIcon('original_name')}
                    </button>
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Duration</th>
                  <th className="text-center p-3 font-medium text-muted-foreground w-16">
                    <Volume2 className="w-3.5 h-3.5 mx-auto" />
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort('status')}
                    >
                      Status {renderSortIcon('status')}
                    </button>
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Tags</th>
                </tr>
              </thead>
              <tbody>
                {pageRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No recordings found
                    </td>
                  </tr>
                ) : (
                  pageRecords.map((record) => (
                    <tr
                      key={record.id}
                      onClick={() => handleRowClick(record)}
                      className={`border-b border-border cursor-pointer hover:bg-accent/50 transition-colors ${
                        selectedRecordId === record.id ? 'bg-accent' : ''
                      }`}
                    >
                      <td className="p-3 w-10" onClick={(e) => toggleCheck(record.id, e)}>
                        <input
                          type="checkbox"
                          checked={checkedIds.has(record.id)}
                          onChange={() => {/* handled by td onClick */}}
                          className="rounded border-input cursor-pointer"
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">
                        {format(new Date(record.recorded_at * 1000), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className="p-3">
                        <span className="font-medium text-foreground truncate block max-w-xs">
                          {record.display_name ?? record.original_name}
                        </span>
                      </td>
                      <td className="p-3">
                        <DurationDisplay seconds={record.duration_seconds} />
                      </td>
                      <td className="p-3 text-center">
                        {!record.audio_deleted ? (
                          <Volume2 className="w-4 h-4 text-green-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={record.status} />
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {record.tags.map((tag) => (
                            <TagPill key={tag.id} tag={tag} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between p-3 border-t border-border text-sm">
            <span className="text-muted-foreground">
              {data.total} total · page {page} of {totalPages}
              {isFetching && <Loader2 className="inline w-3 h-3 ml-2 animate-spin" />}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border border-border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Side sheet */}
      {sideSheetOpen && selectedRecordId !== null && (
        <div className="w-full md:w-[480px] border-l border-border flex flex-col shrink-0">
          <RecordDetail recordId={selectedRecordId} onClose={closeSideSheet} />
        </div>
      )}
    </div>
  );
}
