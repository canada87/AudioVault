import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { fetchProject, generateProject, regenerateProject, deleteProject } from '../api/projects';
import type { ProjectRecord } from '../api/projects';
import ConfirmDialog from '../components/ConfirmDialog';

function fmtDate(ts: number): string {
  return format(new Date(ts * 1000), 'MMM d, yyyy HH:mm');
}

export default function ProjectDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? '', 10);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showSelector, setShowSelector] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId),
    enabled: !Number.isNaN(projectId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const generateMutation = useMutation({
    mutationFn: () => generateProject(projectId),
    onSuccess: () => { setActionError(null); invalidate(); },
    onError: (e: Error) => setActionError(e.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: (ids: number[]) => regenerateProject(projectId, ids),
    onSuccess: () => { setActionError(null); setShowSelector(false); invalidate(); },
    onError: (e: Error) => setActionError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => navigate('/projects'),
    onError: (e: Error) => setActionError(e.message),
  });

  const allEligible = useMemo<ProjectRecord[]>(() => {
    if (!project) return [];
    return [...project.included, ...project.excluded, ...project.pending].sort(
      (a, b) => a.recorded_at - b.recorded_at,
    );
  }, [project]);

  const excludedIds = useMemo(() => new Set(project?.excluded.map((r) => r.id) ?? []), [project]);

  const openSelector = (): void => {
    if (!project) return;
    const defaults = new Set([...project.included, ...project.pending].map((r) => r.id));
    setSelectedIds(defaults);
    setShowSelector(true);
  };

  const toggleSelected = (recordId: number): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  if (Number.isNaN(projectId)) {
    return <div className="p-6 text-sm text-destructive">Invalid project id.</div>;
  }

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <Link to="/projects" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="w-4 h-4" />
        Projects
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{project.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {project.tags.map((tag) => (
              <span key={tag.id} className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">
                {tag.name}
              </span>
            ))}
            {project.tags.length > 1 && (
              <span className="text-xs text-muted-foreground">({project.tag_mode.toUpperCase()})</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {project.report_period_start && project.report_period_end
              ? `Period: ${format(new Date(project.report_period_start * 1000), 'MMM d, yyyy')} – ${format(new Date(project.report_period_end * 1000), 'MMM d, yyyy')}`
              : 'No report generated yet'}
            {project.last_generated_at && ` · last generated ${fmtDate(project.last_generated_at)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          aria-label="Delete project"
          title="Delete project"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {(actionError || project.last_error) && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{actionError ?? project.last_error}</span>
        </div>
      )}

      {/* Pending banner */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-card">
        <span className="text-sm text-foreground">
          {project.pending.length === 0
            ? 'No new meetings since the last report.'
            : `${project.pending.length} new meeting${project.pending.length === 1 ? '' : 's'} not yet included in the report.`}
        </span>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={project.pending.length === 0 || generateMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Update
          </button>
          <button
            type="button"
            onClick={openSelector}
            disabled={allEligible.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Regenerate from selection
          </button>
        </div>
      </div>

      {/* Report */}
      <div className="bg-card rounded-lg border border-border p-4">
        {project.report ? (
          <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:marker:text-foreground prose-a:text-primary">
            <ReactMarkdown>{project.report}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No report yet. Click "Update" once there is at least one summarized recording matching this project's tags.
          </p>
        )}
      </div>

      {/* Included meetings */}
      {project.included.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground">
            {project.included.length} meeting{project.included.length === 1 ? '' : 's'} included in the report
          </div>
          <ul className="divide-y divide-border">
            {[...project.included]
              .sort((a, b) => a.recorded_at - b.recorded_at)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="text-muted-foreground whitespace-nowrap">{fmtDate(r.recorded_at)}</span>
                  <span className="text-foreground truncate">{r.display_name ?? r.original_name}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Selection modal for "regenerate from scratch" */}
      {showSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSelector(false)} aria-hidden="true" />
          <div className="relative bg-card border border-border rounded-lg shadow-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <h3 className="text-base font-semibold text-foreground mb-1">Regenerate report from selection</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Uncheck meetings to leave them out permanently. The report is rebuilt from scratch using only the
              checked meetings.
            </p>
            <div className="flex-1 overflow-auto border border-border rounded-md divide-y divide-border">
              {allEligible.map((r) => (
                <label key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent/30">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelected(r.id)}
                    className="rounded border-input cursor-pointer"
                  />
                  <span className="text-muted-foreground whitespace-nowrap">{fmtDate(r.recorded_at)}</span>
                  <span className="text-foreground truncate flex-1">{r.display_name ?? r.original_name}</span>
                  {excludedIds.has(r.id) && !selectedIds.has(r.id) && (
                    <span className="text-xs text-muted-foreground shrink-0">excluded</span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowSelector(false)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => regenerateMutation.mutate([...selectedIds])}
                disabled={selectedIds.size === 0 || regenerateMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {regenerateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Regenerate ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete project "${project.title}"?`}
        description="The generated report and inclusion history will be deleted. The recordings themselves are not affected. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
