import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Pause, Play, ChevronDown } from 'lucide-react';
import { fetchLogs, clearLogs, type LogEntry } from '../api/logs';

const LEVELS = ['all', 'info', 'warn', 'error', 'fatal'] as const;
type LevelFilter = (typeof LEVELS)[number];

const LEVEL_COLORS: Record<string, string> = {
  trace: 'text-gray-400',
  debug: 'text-gray-500',
  info: 'text-blue-600',
  warn: 'text-yellow-600',
  error: 'text-red-600',
  fatal: 'text-red-800 font-bold',
};

const LEVEL_BG: Record<string, string> = {
  trace: 'bg-gray-100',
  debug: 'bg-gray-100',
  info: 'bg-blue-50',
  warn: 'bg-yellow-50',
  error: 'bg-red-50',
  fatal: 'bg-red-100',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function LogRow({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }): React.ReactElement {
  const levelColor = LEVEL_COLORS[entry.levelLabel] ?? 'text-foreground';
  const bg = LEVEL_BG[entry.levelLabel] ?? '';

  // Build extra details (excluding known fields)
  const extraKeys = Object.keys(entry).filter(
    (k) => !['id', 'level', 'levelLabel', 'msg', 'time', 'pid', 'hostname', 'reqId', 'req', 'res', 'responseTime'].includes(k),
  );
  const hasExtra = extraKeys.length > 0;

  return (
    <div className={`border-b border-border ${bg}`}>
      <div
        className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onToggle}
      >
        <span className="text-xs text-muted-foreground w-10 shrink-0 tabular-nums">
          {formatDate(entry.time)}
        </span>
        <span className="text-xs text-muted-foreground w-16 shrink-0 tabular-nums">
          {formatTime(entry.time)}
        </span>
        <span className={`text-xs font-semibold uppercase w-12 shrink-0 ${levelColor}`}>
          {entry.levelLabel}
        </span>
        <span className="text-xs text-foreground flex-1 font-mono break-all whitespace-pre-wrap">
          {entry.msg || '(no message)'}
        </span>
        {hasExtra && (
          <ChevronDown
            className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </div>
      {expanded && hasExtra && (
        <div className="px-3 pb-2 pl-[10.5rem]">
          <pre className="text-xs font-mono text-muted-foreground bg-background rounded p-2 overflow-x-auto max-h-48">
            {JSON.stringify(
              Object.fromEntries(extraKeys.map((k) => [k, entry[k]])),
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function LogsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<LevelFilter>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['logs', level],
    queryFn: () =>
      fetchLogs({
        level: level === 'all' ? undefined : level,
        limit: 1000,
      }),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, autoScroll]);

  const entries = data?.entries ?? [];
  // Reverse so oldest is at top (entries come newest-first from API)
  const sorted = [...entries].reverse();

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Count by level
  const errorCount = entries.filter((e) => e.level >= 50).length;
  const warnCount = entries.filter((e) => e.level >= 40 && e.level < 50).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">Logs</h1>
          <span className="text-xs text-muted-foreground">
            {data?.total ?? 0} in buffer
          </span>
          {errorCount > 0 && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
              {warnCount} warn{warnCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Level filter */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  level === l
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            className={`p-1.5 rounded-md border transition-colors ${
              autoScroll
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>

          {/* Pause/resume */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            className={`p-1.5 rounded-md border transition-colors ${
              autoRefresh
                ? 'border-green-500 bg-green-50 text-green-600'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          {/* Clear logs */}
          <button
            onClick={() => void clearMutation.mutate()}
            disabled={clearMutation.isPending}
            title="Clear all logs"
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-background">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No log entries
          </div>
        ) : (
          <div className="font-mono text-sm">
            {sorted.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpand(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer status bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
        <span>Max 2000 entries / 24h retention</span>
        <span>{autoRefresh ? 'Refreshing every 3s' : 'Paused'}</span>
        <span>{sorted.length} entries shown</span>
      </div>
    </div>
  );
}
