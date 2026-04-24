import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { fetchTags, createTag, patchTag, deleteTag } from '../api/tags';
import type { TagWithCount } from '../api/tags';
import ConfirmDialog from '../components/ConfirmDialog';

export default function TagsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TagWithCount | null>(null);

  const { data: allTags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['records'] });
  };

  const createMutation = useMutation({
    mutationFn: (name: string) => createTag(name),
    onSuccess: () => {
      setNewTagName('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => patchTag(id, name),
    onSuccess: () => {
      setEditingId(null);
      setEditingValue('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.includes(q));
  }, [allTags, search]);

  const handleCreate = (): void => {
    const name = newTagName.trim();
    if (!name) return;
    createMutation.mutate(name);
  };

  const startEditing = (tag: TagWithCount): void => {
    setEditingId(tag.id);
    setEditingValue(tag.name);
    setError(null);
  };

  const cancelEditing = (): void => {
    setEditingId(null);
    setEditingValue('');
    setError(null);
  };

  const commitEditing = (id: number): void => {
    const name = editingValue.trim();
    if (!name) return;
    renameMutation.mutate({ id, name });
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage tags used to organise your recordings. {allTags.length} total.
        </p>
      </div>

      {/* Create + search */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => { setNewTagName(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="New tag name..."
            className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newTagName.trim() || createMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Create
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* Tag list */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTags.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {allTags.length === 0 ? 'No tags yet. Create your first one above.' : 'No tags match your search.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filteredTags.map((tag) => {
              const isEditing = editingId === tag.id;
              const isBusy =
                (renameMutation.isPending && renameMutation.variables?.id === tag.id) ||
                (deleteMutation.isPending && deleteMutation.variables === tag.id);

              return (
                <li key={tag.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditing(tag.id);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="w-full px-2 py-1 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditing(tag)}
                        className="text-sm font-medium text-foreground hover:text-primary text-left truncate max-w-full"
                      >
                        {tag.name}
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {tag.record_count} {tag.record_count === 1 ? 'record' : 'records'}
                  </span>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => commitEditing(tag.id)}
                          disabled={!editingValue.trim() || isBusy}
                          className="p-1.5 rounded-md text-green-600 hover:bg-green-500/10 disabled:opacity-50 transition-colors"
                          aria-label="Save"
                        >
                          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors"
                          aria-label="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditing(tag)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          aria-label={`Rename ${tag.name}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(tag)}
                          disabled={isBusy}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                          aria-label={`Delete ${tag.name}`}
                        >
                          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `Delete tag "${confirmDelete.name}"?` : ''}
        description={
          confirmDelete
            ? confirmDelete.record_count > 0
              ? `This tag is used by ${confirmDelete.record_count} record${confirmDelete.record_count === 1 ? '' : 's'}. It will be removed from all of them. This action cannot be undone.`
              : 'This action cannot be undone.'
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDelete) {
            deleteMutation.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
