import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, FolderKanban, RefreshCw, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { fetchProjects, createProject } from '../api/projects';
import { fetchTags } from '../api/tags';
import { familyFor } from '../components/tagColors';

export default function ProjectsPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagMode, setTagMode] = useState<'or' | 'and'>('or');
  const [error, setError] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      setShowForm(false);
      setTitle('');
      setSelectedTagIds([]);
      setTagMode('or');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleTag = (id: number): void => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleCreate = (): void => {
    if (!title.trim() || selectedTagIds.length === 0) return;
    createMutation.mutate({ title: title.trim(), tag_ids: selectedTagIds, tag_mode: tagMode });
  };

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group recordings by tag into a project and let an LLM keep a running report of it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New project
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            placeholder="Project title..."
            className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Include recordings tagged with:</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {[...allTags]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  const family = familyFor(tag);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                        selected ? family.filterSelected : family.filterUnselected
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              {allTags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags yet — create some in the Tags page first.</span>
              )}
              {selectedTagIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTagMode(tagMode === 'or' ? 'and' : 'or')}
                  className="px-2 py-0.5 text-xs rounded-full border font-medium transition-colors bg-secondary text-secondary-foreground border-secondary hover:bg-secondary/80"
                  title={tagMode === 'or' ? 'Matching recordings with ANY selected tag' : 'Matching recordings with ALL selected tags'}
                >
                  {tagMode.toUpperCase()}
                </button>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!title.trim() || selectedTagIds.length === 0 || createMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No projects yet. Create your first one above.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((project) => (
              <li
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 cursor-pointer transition-colors"
              >
                <FolderKanban className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{project.title}</span>
                    {project.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {project.report_period_start && project.report_period_end
                      ? `${format(new Date(project.report_period_start * 1000), 'MMM d, yyyy')} – ${format(new Date(project.report_period_end * 1000), 'MMM d, yyyy')}`
                      : 'No report generated yet'}
                    {project.last_generated_at && ` · updated ${format(new Date(project.last_generated_at * 1000), 'MMM d, HH:mm')}`}
                  </div>
                </div>
                {project.last_error && (
                  <span title={`Last generation failed: ${project.last_error}`} className="shrink-0">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  </span>
                )}
                {project.pending_count > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                    <RefreshCw className="w-3 h-3" />
                    {project.pending_count} new
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
