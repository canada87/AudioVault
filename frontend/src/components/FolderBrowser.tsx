import React, { useState, useEffect, useCallback } from 'react';
import { Folder, FileText, ChevronUp, Loader2, X } from 'lucide-react';
import { browseDirectory } from '../api/records';
import type { DirectoryEntry } from '../api/records';

interface FolderBrowserProps {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export default function FolderBrowser({
  open,
  initialPath,
  onSelect,
  onCancel,
}: FolderBrowserProps): React.ReactElement | null {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [txtCount, setTxtCount] = useState(0);

  const navigate = useCallback(async (dir?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await browseDirectory(dir);
      setCurrentPath(result.current);
      setParentPath(result.parent);
      setEntries(result.entries);
      setTxtCount(result.entries.filter((e) => e.type === 'file').length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void navigate(initialPath || undefined);
    }
  }, [open, initialPath, navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Select Folder</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Current path */}
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs font-mono text-muted-foreground truncate">
            {currentPath || 'Root'}
          </p>
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-600">{error}</div>
          ) : (
            <div className="divide-y divide-border">
              {/* Go up */}
              {parentPath !== null && (
                <button
                  type="button"
                  onClick={() => void navigate(parentPath)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left"
                >
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">..</span>
                </button>
              )}

              {entries.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground italic">Empty folder</div>
              )}

              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => {
                    if (entry.type === 'directory') {
                      void navigate(entry.path);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                    entry.type === 'directory'
                      ? 'hover:bg-accent cursor-pointer'
                      : 'opacity-60 cursor-default'
                  }`}
                >
                  {entry.type === 'directory' ? (
                    <Folder className="w-4 h-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-foreground truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {txtCount > 0 ? (
              <span className="text-green-600 font-medium">{txtCount} .txt file{txtCount !== 1 ? 's' : ''} found</span>
            ) : (
              'No .txt files in this folder'
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSelect(currentPath)}
              disabled={!currentPath}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Select this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
