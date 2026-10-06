import React, { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Plus, X, Loader2, Layers } from 'lucide-react';
import { previewTagQuery, tagQueryHasTags } from '../api/projects';
import type { TagQueryGroup, TagQueryNode } from '../api/projects';
import type { TagWithCount } from '../api/tags';
import { familyFor } from './tagColors';

// Nesting levels offered below the root group. The backend accepts a bit more.
const MAX_NESTING = 3;

interface GroupEditorProps {
  group: TagQueryGroup;
  depth: number;
  allTags: TagWithCount[];
  tagsById: Map<number, TagWithCount>;
  onChange: (group: TagQueryGroup) => void;
  onRemove?: () => void;
}

function GroupEditor({ group, depth, allTags, tagsById, onChange, onRemove }: GroupEditorProps): React.ReactElement {
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const isRoot = depth === 0;

  const setChildren = (children: TagQueryNode[]): void => onChange({ ...group, children });
  const updateChild = (index: number, node: TagQueryNode): void =>
    setChildren(group.children.map((c, i) => (i === index ? node : c)));
  const removeChild = (index: number): void => setChildren(group.children.filter((_, i) => i !== index));

  const addTag = (tagId: number): void =>
    setChildren([...group.children, { type: 'tag', tag_id: tagId, not: false }]);
  // Alternate AND/OR with depth: a sub-group is almost always the "other" operator.
  const addGroup = (): void =>
    setChildren([
      ...group.children,
      { type: 'group', op: group.op === 'and' ? 'or' : 'and', not: false, children: [] },
    ]);

  const usedTagIds = new Set(group.children.flatMap((c) => (c.type === 'tag' ? [c.tag_id] : [])));
  const q = filter.trim().toLowerCase();
  const pickable = [...allTags]
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const opButton = (op: 'and' | 'or', label: string, hint: string): React.ReactElement => (
    <button
      type="button"
      onClick={() => onChange({ ...group, op })}
      title={hint}
      className={`px-2.5 py-0.5 text-xs font-semibold transition-colors ${
        group.op === op
          ? 'bg-primary text-primary-foreground'
          : 'bg-background text-muted-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={isRoot ? 'space-y-3' : 'space-y-3 rounded-md border border-border bg-muted/30 p-3'}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!isRoot && (
          <button
            type="button"
            onClick={() => onChange({ ...group, not: !group.not })}
            title={group.not ? 'Click to stop negating this group' : 'Click to negate this whole group'}
            className={`px-2 py-0.5 text-xs font-semibold rounded border transition-colors ${
              group.not
                ? 'bg-destructive/15 text-destructive border-destructive/40'
                : 'bg-background text-muted-foreground/60 border-input hover:text-foreground'
            }`}
          >
            NOT
          </button>
        )}
        <span className="text-muted-foreground">Recording has</span>
        <div className="inline-flex rounded-md border border-input overflow-hidden divide-x divide-input">
          {opButton('and', 'ALL', 'All of the items below must match (AND)')}
          {opButton('or', 'ANY', 'At least one of the items below must match (OR)')}
        </div>
        <span className="text-muted-foreground">of:</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Remove group"
            title="Remove group"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {group.children.some((c) => c.type === 'tag') && (
        <div className="flex flex-wrap gap-1.5">
          {group.children.map((child, index) => {
            if (child.type !== 'tag') return null;
            const tag = tagsById.get(child.tag_id);
            const chipClasses = child.not
              ? 'bg-destructive/10 text-destructive border-destructive/40'
              : tag
                ? familyFor(tag).filterSelected
                : 'bg-muted text-muted-foreground border-border';
            return (
              <span
                key={`tag-${child.tag_id}`}
                className={`inline-flex items-center gap-1 pl-1 pr-1.5 py-0.5 text-xs rounded-full border ${chipClasses}`}
              >
                <button
                  type="button"
                  onClick={() => updateChild(index, { ...child, not: !child.not })}
                  title={child.not ? 'Excluded — click to include instead' : 'Click to exclude recordings with this tag (NOT)'}
                  className={`px-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-opacity ${
                    child.not ? 'bg-destructive text-destructive-foreground' : 'opacity-40 hover:opacity-100'
                  }`}
                >
                  not
                </button>
                <span>{tag?.name ?? `#${child.tag_id}`}</span>
                <button
                  type="button"
                  onClick={() => removeChild(index)}
                  className="opacity-60 hover:opacity-100"
                  aria-label="Remove tag"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {group.children.map((child, index) =>
        child.type === 'group' ? (
          <GroupEditor
            key={`group-${index}`}
            group={child}
            depth={depth + 1}
            allTags={allTags}
            tagsById={tagsById}
            onChange={(g) => updateChild(index, g)}
            onRemove={() => removeChild(index)}
          />
        ) : null,
      )}

      {picking && (
        <div className="rounded-md border border-border bg-background p-2 space-y-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags..."
            autoFocus
            className="w-full px-2 py-1 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
            {pickable.map((tag) => {
              const used = usedTagIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={used}
                  onClick={() => addTag(tag.id)}
                  title={tag.parent_name ? `${tag.parent_name} › ${tag.name}` : tag.name}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${familyFor(tag).filterUnselected} ${
                    used ? 'opacity-30 cursor-not-allowed' : ''
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
            {pickable.length === 0 && (
              <span className="text-xs text-muted-foreground">
                {allTags.length === 0 ? 'No tags yet — create some in the Tags page first.' : 'No tag matches.'}
              </span>
            )}
          </div>
        </div>
      )}

      {isRoot && group.children.length === 0 && !picking && (
        <p className="text-xs text-muted-foreground">Nothing selected yet — add a tag to start.</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPicking((v) => !v);
            setFilter('');
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors"
        >
          {picking ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {picking ? 'Done' : 'Tag'}
        </button>
        {depth < MAX_NESTING && (
          <button
            type="button"
            onClick={addGroup}
            title="Add a sub-group to combine tags differently, e.g. (A AND B) OR C"
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors"
          >
            <Layers className="w-3 h-3" />
            Group
          </button>
        )}
      </div>
    </div>
  );
}

interface TagQueryBuilderProps {
  value: TagQueryGroup;
  onChange: (value: TagQueryGroup) => void;
  allTags: TagWithCount[];
}

export default function TagQueryBuilder({ value, onChange, allTags }: TagQueryBuilderProps): React.ReactElement {
  const tagsById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);
  const hasTags = tagQueryHasTags(value);

  const { data: preview, error, isFetching } = useQuery({
    queryKey: ['tag-query-preview', value],
    queryFn: () => previewTagQuery(value),
    enabled: hasTags,
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <div className="space-y-3">
      <GroupEditor group={value} depth={0} allTags={allTags} tagsById={tagsById} onChange={onChange} />

      {hasTags && (
        <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1">
          {error ? (
            <div className="text-xs text-destructive">{error.message}</div>
          ) : preview ? (
            <>
              <div className="font-mono text-xs text-foreground break-words">{preview.text}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                {preview.total} recording{preview.total === 1 ? '' : 's'} match · {preview.summarized} with a summary
                (only those are used for the report)
              </div>
            </>
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
    </div>
  );
}
