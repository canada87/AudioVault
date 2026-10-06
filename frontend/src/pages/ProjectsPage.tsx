import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, FolderKanban, RefreshCw, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { fetchProjects, createProject, emptyTagQuery, tagQueryHasTags } from '../api/projects';
import type { TagQueryGroup } from '../api/projects';
import { fetchTags } from '../api/tags';
import TagQueryBuilder from '../components/TagQueryBuilder';

export default function ProjectsPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [tagQuery, setTagQuery] = useState<TagQueryGroup>(emptyTagQuery());
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
      setTagQuery(emptyTagQuery());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const canCreate = title.trim().length > 0 && tagQueryHasTags(tagQuery);

  const handleCreate = (): void => {
    if (!canCreate) return;
    createMutation.mutate({ title: title.trim(), tag_query: tagQuery });
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
            <div className="text-xs font-medium text-muted-foreground">Include recordings that match:</div>
            <TagQueryBuilder
              value={tagQuery}
              onChange={(q) => { setTagQuery(q); setError(null); }}
              allTags={allTags}
            />
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
              disabled={!canCreate || createMutation.isPending}
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
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono" title={project.tag_query_text}>
                    {project.tag_query_text || 'No tags selected'}
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
