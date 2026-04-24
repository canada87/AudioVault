import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight, FolderTree } from 'lucide-react';
import { fetchTags, createTag, patchTag, deleteTag } from '../api/tags';
import type { TagWithCount } from '../api/tags';
import ConfirmDialog from '../components/ConfirmDialog';

interface TagNode extends TagWithCount {
  children: TagNode[];
}

function buildTree(tags: TagWithCount[]): TagNode[] {
  const byId = new Map<number, TagNode>();
  tags.forEach((t) => byId.set(t.id, { ...t, children: [] }));

  const roots: TagNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      // Root, or orphaned (parent not in list) — treat as root
      roots.push(node);
    }
  }

  const sortByName = (nodes: TagNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortByName(n.children));
  };
  sortByName(roots);
  return roots;
}

function filterTree(nodes: TagNode[], q: string): TagNode[] {
  if (!q) return nodes;
  const out: TagNode[] = [];
  for (const node of nodes) {
    const selfMatch = node.name.includes(q);
    const filteredChildren = filterTree(node.children, q);
    if (selfMatch || filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren });
    }
  }
  return out;
}

export default function TagsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagParent, setNewTagParent] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [reparentingId, setReparentingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TagWithCount | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const { data: allTags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['records'] });
  };

  const createMutation = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: number | null }) => createTag(name, parentId),
    onSuccess: () => {
      setNewTagName('');
      setNewTagParent(null);
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => patchTag(id, { name }),
    onSuccess: () => {
      setEditingId(null);
      setEditingValue('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const reparentMutation = useMutation({
    mutationFn: ({ id, parent_id }: { id: number; parent_id: number | null }) =>
      patchTag(id, { parent_id }),
    onSuccess: () => {
      setReparentingId(null);
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

  const tree = useMemo(() => {
    const full = buildTree(allTags);
    return filterTree(full, search.trim().toLowerCase());
  }, [allTags, search]);

  // Root tags = tags that have no parent AND no children would cause depth > 2.
  // Any tag can be a root; only root tags (parent_id === null) may be chosen as parents of other tags.
  const rootTags = useMemo(
    () => allTags.filter((t) => t.parent_id == null).sort((a, b) => a.name.localeCompare(b.name)),
    [allTags],
  );

  // For the parent dropdown when editing a tag, we must exclude:
  // - the tag itself
  // - any tag that already has children (they are roots-with-kids; choosing them as parent
  //   would be fine depth-wise *except* our rule says parent must be a root with no parent,
  //   which any root satisfies. But a tag with children can still be a parent for this tag.
  // Reformulation: parent candidate must have parent_id === null (i.e., be a root). That's it.
  // (A root "with children" is still a valid parent for other tags.)
  // We also exclude: the tag itself, and any tag that has its own children (because if THIS tag
  // had children, the server would reject — but the check is that THIS tag has no children,
  // not the candidate parent.)
  const eligibleParentsFor = (tagId: number): TagWithCount[] => {
    const hasChildren = allTags.some((t) => t.parent_id === tagId);
    if (hasChildren) return []; // This tag cannot be moved under anyone
    return rootTags.filter((t) => t.id !== tagId);
  };

  const handleCreate = (): void => {
    const name = newTagName.trim();
    if (!name) return;
    createMutation.mutate({ name, parentId: newTagParent });
  };

  const startEditing = (tag: TagWithCount): void => {
    setEditingId(tag.id);
    setEditingValue(tag.name);
    setReparentingId(null);
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

  const startReparenting = (tag: TagWithCount): void => {
    setReparentingId(tag.id);
    setEditingId(null);
    setError(null);
  };

  const toggleCollapse = (id: number): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TagNode, depth: number): React.ReactElement => {
    const isEditing = editingId === node.id;
    const isReparenting = reparentingId === node.id;
    const isBusy =
      (renameMutation.isPending && renameMutation.variables?.id === node.id) ||
      (reparentMutation.isPending && reparentMutation.variables?.id === node.id) ||
      (deleteMutation.isPending && deleteMutation.variables === node.id);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const parents = eligibleParentsFor(node.id);

    return (
      <React.Fragment key={node.id}>
        <li
          className="flex items-center gap-2 px-4 py-2 hover:bg-accent/30 transition-colors"
          style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
        >
          {/* Collapse chevron / spacer */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleCollapse(node.id)}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground transition-colors"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-[1.375rem] inline-block" />
          )}

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                type="text"
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditing(node.id);
                  if (e.key === 'Escape') cancelEditing();
                }}
                className="w-full px-2 py-1 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : isReparenting ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{node.name}</span>
                <span className="text-xs text-muted-foreground">move under:</span>
                <select
                  autoFocus
                  defaultValue={node.parent_id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const parent_id = v === '' ? null : parseInt(v, 10);
                    reparentMutation.mutate({ id: node.id, parent_id });
                  }}
                  className="px-2 py-1 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— (root)</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setReparentingId(null)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
                  aria-label="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startEditing(node)}
                className="text-sm font-medium text-foreground hover:text-primary text-left truncate max-w-full"
              >
                {node.name}
              </button>
            )}
          </div>

          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {node.record_count} {node.record_count === 1 ? 'record' : 'records'}
          </span>

          <div className="flex items-center gap-0.5">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => commitEditing(node.id)}
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
            ) : !isReparenting ? (
              <>
                <button
                  type="button"
                  onClick={() => startEditing(node)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={`Rename ${node.name}`}
                  title="Rename"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => startReparenting(node)}
                  disabled={isBusy}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                  aria-label={`Move ${node.name}`}
                  title={hasChildren ? 'This tag has children and cannot be moved' : 'Change parent'}
                >
                  <FolderTree className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(node)}
                  disabled={isBusy}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                  aria-label={`Delete ${node.name}`}
                  title="Delete"
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </>
            ) : null}
          </div>
        </li>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage tags used to organise your recordings. Hierarchy supports up to 2 levels. {allTags.length} total.
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
          <select
            value={newTagParent ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setNewTagParent(v === '' ? null : parseInt(v, 10));
            }}
            className="px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            title="Parent (optional)"
          >
            <option value="">— No parent —</option>
            {rootTags.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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

      {/* Tag tree */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {allTags.length === 0 ? 'No tags yet. Create your first one above.' : 'No tags match your search.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tree.map((node) => renderNode(node, 0))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `Delete tag "${confirmDelete.name}"?` : ''}
        description={
          confirmDelete
            ? (() => {
                const parts: string[] = [];
                if (confirmDelete.record_count > 0) {
                  parts.push(
                    `This tag is used by ${confirmDelete.record_count} record${confirmDelete.record_count === 1 ? '' : 's'}. It will be removed from all of them.`,
                  );
                }
                const childCount = allTags.filter((t) => t.parent_id === confirmDelete.id).length;
                if (childCount > 0) {
                  parts.push(
                    `${childCount} child tag${childCount === 1 ? '' : 's'} will be promoted to root tags.`,
                  );
                }
                parts.push('This action cannot be undone.');
                return parts.join(' ');
              })()
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
