import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, Save, RotateCcw, Upload, FolderOpen } from 'lucide-react';
import { fetchSettings, patchSettings } from '../api/settings';
import { fetchStats } from '../api/stats';
import { importTranscriptions } from '../api/records';
import type { ImportResult } from '../api/records';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import FolderBrowser from '../components/FolderBrowser';

type EditableKey =
  | { key: string; label: string; type: 'text' | 'number' | 'password'; help: string; options?: never }
  | { key: string; label: string; type: 'select'; help: string; options: { value: string; label: string }[] };

const EDITABLE_KEYS: EditableKey[] = [
  { key: 'AUDIO_DIR', label: 'Audio Directory', type: 'text', help: 'Path to the folder containing audio/video files' },
  {
    key: 'STT_POLL_INTERVAL_SECONDS',
    label: 'STT Poll Interval (seconds)',
    type: 'number',
    help: 'How often to check transcription progress',
  },
  {
    key: 'STT_POLL_TIMEOUT_SECONDS',
    label: 'STT Poll Timeout (seconds)',
    type: 'number',
    help: 'Max wait time before transcription is considered failed',
  },
  { key: 'LLM_DAILY_LIMIT', label: 'LLM Daily Limit', type: 'number', help: 'Max LLM calls per day' },
  {
    key: 'TRANSCRIPTION_CRON',
    label: 'Transcription Cron',
    type: 'text',
    help: 'Cron expression for auto-transcription (e.g. "0 4 * * *")',
  },
  {
    key: 'LLM_POLL_INTERVAL',
    label: 'LLM Poll Interval (minutes)',
    type: 'number',
    help: 'How often to check for transcribed records needing summaries',
  },
  {
    key: 'LLM_PROVIDER',
    label: 'LLM Provider',
    type: 'select',
    help: 'Which LLM provider to use for summarisation',
    options: [
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'openai', label: 'OpenAI' },
    ],
  },
  {
    key: 'GEMINI_MODEL',
    label: 'Gemini Model',
    type: 'text',
    help: 'Model name used when provider is Gemini (e.g. gemini-2.5-flash)',
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI Model',
    type: 'text',
    help: 'Model name used when provider is OpenAI (e.g. gpt-4o)',
  },
];

export default function SettingsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [promptValue, setPromptValue] = useState('');
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [importDir, setImportDir] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
  });

  useEffect(() => {
    if (settings) {
      const initial: Record<string, string> = {};
      for (const { key } of EDITABLE_KEYS) {
        initial[key] = settings[key] ?? '';
      }
      setFormValues(initial);
      setPromptValue(settings['LLM_PROMPT'] ?? '');
    }
  }, [settings]);

  const importMutation = useMutation({
    mutationFn: (directory: string) => importTranscriptions(directory),
    onSuccess: (data) => {
      setImportResult(data);
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = { ...formValues };
      if (promptValue) {
        payload['LLM_PROMPT'] = promptValue;
      }
      return patchSettings(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    },
  });

  // Build last 30 days chart data
  const chartData = React.useMemo(() => {
    if (!stats) return [];
    const today = new Date();
    const days = eachDayOfInterval({ start: subDays(today, 29), end: today });
    const usageMap = new Map(
      stats.llm.usageLast30Days.map((d) => [d.date, d.count]),
    );
    return days.map((day) => ({
      date: format(day, 'MM/dd'),
      count: usageMap.get(format(day, 'yyyy-MM-dd')) ?? 0,
    }));
  }, [stats]);

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      {/* Stats summary */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.records.total, color: 'text-foreground' },
            { label: 'Done', value: stats.records.done, color: 'text-green-600' },
            { label: 'Pending', value: stats.records.pending, color: 'text-gray-600' },
            { label: 'Errors', value: stats.records.error, color: 'text-red-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card rounded-lg border border-border p-4 text-center">
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              <div className="text-sm text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* LLM usage chart */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground mb-1">LLM Usage — Last 30 Days</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Daily limit: {stats?.llm.dailyLimit ?? '—'} · Remaining today: {stats?.llm.remaining ?? '—'}
        </p>
        {statsLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(214.3 31.8% 91.4%)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(215.4 16.3% 46.9%)' }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(215.4 16.3% 46.9%)' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(0 0% 100%)',
                  border: '1px solid hsl(214.3 31.8% 91.4%)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="count" fill="hsl(222.2 47.4% 11.2%)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Editable settings */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-4">
        <h2 className="text-base font-semibold text-foreground">Configuration</h2>

        {EDITABLE_KEYS.map(({ key, label, type, help, options }) => (
          <div key={key} className="space-y-1">
            <label htmlFor={key} className="text-sm font-medium text-foreground">
              {label}
            </label>
            {type === 'select' ? (
              <select
                id={key}
                value={formValues[key] ?? ''}
                onChange={(e) => setFormValues((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                id={key}
                type={type}
                value={formValues[key] ?? ''}
                onChange={(e) => setFormValues((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            <p className="text-xs text-muted-foreground">{help}</p>
          </div>
        ))}

        {/* Prompt template */}
        <div className="space-y-1">
          <label htmlFor="prompt" className="text-sm font-medium text-foreground">
            LLM Prompt Template
          </label>
          <textarea
            id="prompt"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            rows={10}
            placeholder="Use {transcription} as placeholder for the transcription text..."
            className="w-full px-3 py-2 text-sm font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
          <p className="text-xs text-muted-foreground">
            Use {'{transcription}'} as placeholder. Leave empty to use the built-in default.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => void saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saved ? 'Saved!' : 'Save settings'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (settings) {
                const reset: Record<string, string> = {};
                for (const { key } of EDITABLE_KEYS) {
                  reset[key] = settings[key] ?? '';
                }
                setFormValues(reset);
                setPromptValue(settings['LLM_PROMPT'] ?? '');
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Import transcriptions */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-4">
        <h2 className="text-base font-semibold text-foreground">Import Transcriptions</h2>
        <p className="text-xs text-muted-foreground">
          Import .txt files with format "YYYY-MM-DD HH-MM-SS.txt" or "YYYY-MM-DD HH-MM-SS - name.txt".
          Records will be created with status "transcribed" and audio marked as deleted.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={importDir}
            onChange={(e) => { setImportDir(e.target.value); setImportResult(null); }}
            placeholder="Path to folder containing .txt files..."
            className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setFolderBrowserOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
            title="Browse folders"
          >
            <FolderOpen className="w-4 h-4" />
            Browse
          </button>
          <button
            type="button"
            onClick={() => void importMutation.mutate(importDir)}
            disabled={!importDir.trim() || importMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {importMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Import
          </button>
        </div>
        <FolderBrowser
          open={folderBrowserOpen}
          initialPath={importDir || undefined}
          onSelect={(selectedPath) => {
            setImportDir(selectedPath);
            setImportResult(null);
            setFolderBrowserOpen(false);
          }}
          onCancel={() => setFolderBrowserOpen(false)}
        />
        {importMutation.isError && (
          <p className="text-sm text-red-600">
            {importMutation.error instanceof Error ? importMutation.error.message : 'Import failed'}
          </p>
        )}
        {importResult && (
          <div className="text-sm space-y-1 p-3 bg-muted/50 rounded-md">
            <p>
              <span className="font-medium text-green-600">{importResult.imported}</span> imported,{' '}
              <span className="font-medium text-muted-foreground">{importResult.skipped}</span> skipped (already exist)
              {importResult.errors.length > 0 && (
                <>, <span className="font-medium text-red-600">{importResult.errors.length}</span> errors</>
              )}
            </p>
            {importResult.errors.length > 0 && (
              <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                {importResult.errors.map((e, i) => (
                  <li key={i}>{e.file}: {e.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
