import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FileText, Loader2, Trash2, UploadCloud, X } from 'lucide-react';
import {
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  deleteProjectDocument,
  documentDownloadUrl,
  fetchProjectDocuments,
  uploadProjectDocument,
} from '../api/documents';
import type { ProjectDocument } from '../api/documents';
import ConfirmDialog from './ConfirmDialog';

interface UploadItem {
  key: string;
  name: string;
  status: 'uploading' | 'error';
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validate(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Unsupported type. Allowed: ${DOCUMENT_EXTENSIONS.join(', ')}`;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `Too large (max ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB)`;
  }
  return null;
}

// Documents stored with one project. Kept on the server's disk, never used to generate reports.
export default function ProjectDocumentsBox({ projectId }: { projectId: number }): React.ReactElement {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave also fire for child elements: count them instead of toggling a boolean.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<ProjectDocument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['project-documents', projectId],
    queryFn: () => fetchProjectDocuments(projectId),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
  };

  const uploadFiles = (files: File[]): void => {
    files.forEach((file, index) => {
      const key = `${Date.now()}-${index}-${file.name}`;
      const problem = validate(file);
      if (problem) {
        setUploads((prev) => [...prev, { key, name: file.name, status: 'error', error: problem }]);
        return;
      }

      setUploads((prev) => [...prev, { key, name: file.name, status: 'uploading' }]);
      uploadProjectDocument(projectId, file).then(
        () => {
          setUploads((prev) => prev.filter((u) => u.key !== key));
          refresh();
        },
        (e: Error) => {
          setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, status: 'error', error: e.message } : u)));
        },
      );
    });
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    uploadFiles([...e.dataTransfer.files]);
  };

  const handleDelete = (doc: ProjectDocument): void => {
    setConfirmDelete(null);
    deleteProjectDocument(projectId, doc.id).then(
      () => { setDeleteError(null); refresh(); },
      (e: Error) => setDeleteError(e.message),
    );
  };

  const openPicker = (): void => inputRef.current?.click();

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="mb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Documents{documents.length > 0 && ` (${documents.length})`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Files kept with this project — stored locally, never used to generate reports.
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
          dragging ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/60 hover:bg-accent/40'
        }`}
      >
        <UploadCloud className={`w-6 h-6 ${dragging ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-sm text-foreground">
          {dragging ? 'Drop to upload' : 'Drag documents here, or click to browse'}
        </span>
        <span className="text-xs text-muted-foreground">
          {DOCUMENT_EXTENSIONS.join(' ')} · up to {Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB each
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_EXTENSIONS.join(',')}
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            uploadFiles([...(e.target.files ?? [])]);
            e.target.value = ''; // let the same file be picked again
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="mt-2 space-y-1">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                u.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              {u.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 mt-px" />}
              <span className="flex-1 min-w-0">
                <span className="font-medium break-all">{u.name}</span>
                {u.status === 'uploading' ? ' — uploading…' : ` — ${u.error}`}
              </span>
              {u.status === 'error' && (
                <button
                  type="button"
                  onClick={() => setUploads((prev) => prev.filter((x) => x.key !== u.key))}
                  className="shrink-0 opacity-70 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}

      {isLoading ? (
        <Loader2 className="mt-3 w-4 h-4 animate-spin text-muted-foreground" />
      ) : documents.length === 0 ? (
        uploads.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 py-2">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <a
                href={documentDownloadUrl(projectId, doc.id)}
                download={doc.name}
                title="Click to download"
                className="flex-1 min-w-0 group"
              >
                <div className="text-sm text-foreground truncate group-hover:underline">{doc.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(doc.size_bytes)} · {format(new Date(doc.created_at * 1000), 'MMM d, yyyy HH:mm')}
                </div>
              </a>
              <button
                type="button"
                onClick={() => setConfirmDelete(doc)}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                aria-label={`Delete ${doc.name}`}
                title="Delete document"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        description="The file will be permanently removed from this project. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
