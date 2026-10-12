import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  Plus,
  FolderKanban,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { fetchProjects, createProject, patchProject, emptyTagQuery, tagQueryHasTags } from '../api/projects';
import type { ProjectSummary, TagQueryGroup } from '../api/projects';
import {
  fetchProjectFolders,
  createProjectFolder,
  renameProjectFolder,
  deleteProjectFolder,
} from '../api/projectFolders';
import type { ProjectFolder } from '../api/projectFolders';
import { fetchTags } from '../api/tags';
import TagQueryBuilder from '../components/TagQueryBuilder';
import ConfirmDialog from '../components/ConfirmDialog';

const COLLAPSED_KEY = 'audiovault.projects.collapsedFolders';
const NO_FOLDER = 'none';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Remembering which folders are collapsed is a convenience only.
  }
}

interface ProjectRowProps {
  project: ProjectSummary;
  folders: ProjectFolder[];
  onOpen: () => void;
  onMove: (folderId: number | null) => void;
  moving: boolean;
}

function ProjectRow({ project, folders, onOpen, onMove, moving }: ProjectRowProps): React.ReactElement {
  return (
    <li
      onClick={onOpen}
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
      <select
        value={project.folder_id ?? ''}
        disabled={moving}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMove(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        aria-label={`Move "${project.title}" to a folder`}
        title="Move to folder"
        className="shrink-0 max-w-[9rem] px-2 py-1 text-xs rounded-md border border-input bg-background text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </li>
  );
}

export default function ProjectsPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [newProjectFolder, setNewProjectFolder] = useState<number | null>(null);
  const [tagQuery, setTagQuery] = useState<TagQueryGroup>(emptyTagQuery());
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<ProjectFolder | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['project-folders'],
    queryFn: fetchProjectFolders,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const refreshAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['project-folders'] });
  };

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      setShowForm(false);
      setTitle('');
      setNewProjectFolder(null);
      setTagQuery(emptyTagQuery());
      setError(null);
      refreshAll();
      navigate(`/projects/${project.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, folderId }: { id: number; folderId: number | null }) =>
      patchProject(id, { folder_id: folderId }),
    onSuccess: (_data, { id }) => {
      setFolderError(null);
      refreshAll();
      void queryClient.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (e: Error) => setFolderError(e.message),
  });

  const createFolderMutation = useMutation({
    mutationFn: createProjectFolder,
    onSuccess: () => {
      setFolderName('');
      setShowFolderForm(false);
      setFolderError(null);
      refreshAll();
    },
    onError: (e: Error) => setFolderError(e.message),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameProjectFolder(id, name),
    onSuccess: () => {
      setRenamingId(null);
      setFolderError(null);
      refreshAll();
    },
    onError: (e: Error) => setFolderError(e.message),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: number) => deleteProjectFolder(id),
    onSuccess: () => {
      setConfirmDeleteFolder(null);
      setFolderError(null);
      refreshAll();
    },
    onError: (e: Error) => {
      setConfirmDeleteFolder(null);
      setFolderError(e.message);
    },
  });

  const canCreate = title.trim().length > 0 && tagQueryHasTags(tagQuery);

  const handleCreate = (): void => {
    if (!canCreate) return;
    createMutation.mutate({ title: title.trim(), tag_query: tagQuery, folder_id: newProjectFolder });
  };

  const toggleCollapsed = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  const searching = search.trim().length > 0;

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) => p.title.toLowerCase().includes(needle) || p.tag_query_text.toLowerCase().includes(needle),
    );
  }, [projects, search]);

  const projectsByFolder = useMemo(() => {
    const map = new Map<string, ProjectSummary[]>();
    for (const p of visibleProjects) {
      const key = p.folder_id != null ? String(p.folder_id) : NO_FOLDER;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [visibleProjects]);

  const looseProjects = projectsByFolder.get(NO_FOLDER) ?? [];
  // While searching, hide folders that have no match so the results aren't buried in empty sections.
  const shownFolders = searching ? folders.filter((f) => (projectsByFolder.get(String(f.id)) ?? []).length > 0) : folders;

  const submitRename = (folder: ProjectFolder): void => {
    const name = renameDraft.trim();
    if (!name) return;
    if (name === folder.name) {
      setRenamingId(null);
      return;
    }
    renameFolderMutation.mutate({ id: folder.id, name });
  };

  const renderRows = (list: ProjectSummary[]): React.ReactElement => (
    <ul className="divide-y divide-border">
      {list.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          folders={folders}
          onOpen={() => navigate(`/projects/${project.id}`)}
          onMove={(folderId) => moveMutation.mutate({ id: project.id, folderId })}
          moving={moveMutation.isPending && moveMutation.variables?.id === project.id}
        />
      ))}
    </ul>
  );

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group recordings by tag into a project and let an LLM keep a running report of it.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { setShowFolderForm((v) => !v); setFolderError(null); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            New folder
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New project
          </button>
        </div>
      </div>

      {showFolderForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (folderName.trim()) createFolderMutation.mutate(folderName.trim());
          }}
          className="flex items-center gap-2 bg-card rounded-lg border border-border p-3"
        >
          <input
            type="text"
            autoFocus
            value={folderName}
            onChange={(e) => { setFolderName(e.target.value); setFolderError(null); }}
            placeholder="Folder name..."
            maxLength={100}
            className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => { setShowFolderForm(false); setFolderName(''); setFolderError(null); }}
            className="px-3 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!folderName.trim() || createFolderMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {createFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create folder
          </button>
        </form>
      )}

      {showForm && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            placeholder="Project title..."
            className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {folders.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="new-project-folder" className="text-xs font-medium text-muted-foreground">
                Folder:
              </label>
              <select
                id="new-project-folder"
                value={newProjectFolder ?? ''}
                onChange={(e) => setNewProjectFolder(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                className="px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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

      {projects.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects by title or tags..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {folderError && <p className="text-sm text-destructive">{folderError}</p>}

      {isLoading ? (
        <div className="bg-card rounded-lg border border-border flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 && folders.length === 0 ? (
        <div className="bg-card rounded-lg border border-border text-center py-12 text-muted-foreground text-sm">
          No projects yet. Create your first one above.
        </div>
      ) : searching && visibleProjects.length === 0 ? (
        <div className="bg-card rounded-lg border border-border text-center py-12 text-muted-foreground text-sm">
          No projects match "{search.trim()}".
        </div>
      ) : (
        <div className="space-y-4">
          {shownFolders.map((folder) => {
            const key = String(folder.id);
            const list = projectsByFolder.get(key) ?? [];
            // Searching always expands folders so matches are visible.
            const isCollapsed = collapsed.has(key) && !searching;
            const isRenaming = renamingId === folder.id;
            return (
              <section key={folder.id} className="bg-card rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                  {isRenaming ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); submitRename(folder); }}
                      className="flex flex-1 items-center gap-2"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                        maxLength={100}
                        aria-label="Folder name"
                        className="flex-1 px-2 py-1 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="submit"
                        disabled={!renameDraft.trim() || renameFolderMutation.isPending}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                        aria-label="Save folder name"
                        title="Save"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                        aria-label="Cancel rename"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(key)}
                        aria-expanded={!isCollapsed}
                        className="flex flex-1 min-w-0 items-center gap-2 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        {isCollapsed ? (
                          <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm font-semibold text-foreground truncate">{folder.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {searching ? list.length : folder.project_count}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenamingId(folder.id); setRenameDraft(folder.name); setFolderError(null); }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        aria-label={`Rename folder ${folder.name}`}
                        title="Rename folder"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFolder(folder)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label={`Delete folder ${folder.name}`}
                        title="Delete folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {!isCollapsed &&
                  (list.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-muted-foreground">
                      Empty folder. Use the menu on a project to move it here.
                    </div>
                  ) : (
                    renderRows(list)
                  ))}
              </section>
            );
          })}

          {(looseProjects.length > 0 || (folders.length === 0 && !searching)) && (
            <section className="bg-card rounded-lg border border-border overflow-hidden">
              {folders.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(NO_FOLDER)}
                    aria-expanded={!(collapsed.has(NO_FOLDER) && !searching)}
                    className="flex flex-1 min-w-0 items-center gap-2 text-left"
                  >
                    {collapsed.has(NO_FOLDER) && !searching ? (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-muted-foreground">No folder</span>
                    <span className="text-xs text-muted-foreground shrink-0">{looseProjects.length}</span>
                  </button>
                </div>
              )}
              {!(collapsed.has(NO_FOLDER) && !searching && folders.length > 0) && renderRows(looseProjects)}
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteFolder !== null}
        title={`Delete folder "${confirmDeleteFolder?.name ?? ''}"?`}
        description="Only the folder is removed. Its projects are kept and move back to 'No folder'."
        confirmLabel="Delete folder"
        destructive
        onConfirm={() => confirmDeleteFolder && deleteFolderMutation.mutate(confirmDeleteFolder.id)}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
    </div>
  );
}
