import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import WaveSurfer from 'wavesurfer.js';
import {
  X,
  Play,
  Pause,
  Download,
  Trash2,
  Mic,
  Sparkles,
  FileText,
  Info,
  Tag as TagIcon,
  Volume2,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  fetchRecord,
  patchRecord,
  deleteAudio,
  deleteRecord,
  triggerTranscribe,
  triggerSummarize,
  getAudioUrl,
  getExportUrl,
} from '../api/records';
import type { AudioRecord } from '../api/records';
import { fetchTags, createTag } from '../api/tags';
import type { TagWithCount } from '../api/tags';
import StatusBadge from '../components/StatusBadge';
import TagPill from '../components/TagPill';
import DurationDisplay from '../components/DurationDisplay';
import ConfirmDialog from '../components/ConfirmDialog';

interface RecordDetailProps {
  recordId: number;
  onClose: () => void;
}

type TabId = 'transcription' | 'summary' | 'info';

export default function RecordDetail({ recordId, onClose }: RecordDetailProps): React.ReactElement {
  const queryClient = useQueryClient();
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('transcription');
  const [suffix, setSuffix] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const { data: record, isLoading } = useQuery({
    queryKey: ['record', recordId],
    queryFn: () => fetchRecord(recordId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'transcribing' || status === 'processing') return 3000;
      return false;
    },
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  // Initialize WaveSurfer
  useEffect(() => {
    if (!record || record.audio_deleted || !waveformRef.current) return;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: 'hsl(222.2 47.4% 11.2% / 0.3)',
      progressColor: 'hsl(222.2 47.4% 11.2%)',
      cursorColor: 'hsl(222.2 47.4% 11.2%)',
      barWidth: 2,
      barGap: 1,
      height: 60,
      normalize: true,
    });

    ws.load(getAudioUrl(record.id));
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [record?.id, record?.audio_deleted]);

  const renameMutation = useMutation({
    mutationFn: () => patchRecord(recordId, { suffix }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      setSuffix('');
    },
  });

  const tagsMutation = useMutation({
    mutationFn: (tagIds: number[]) => patchRecord(recordId, { tagIds }),
    onMutate: async (newTagIds) => {
      // Cancel in-flight refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['record', recordId] });
      const previous = queryClient.getQueryData<AudioRecord>(['record', recordId]);
      // Optimistically update the cache so subsequent tag operations see current state
      queryClient.setQueryData<AudioRecord>(['record', recordId], (old) => {
        if (!old) return old;
        const newTags = newTagIds
          .map((id) => allTags.find((t) => t.id === id))
          .filter((t): t is TagWithCount => t !== undefined);
        return { ...old, tags: newTags };
      });
      return { previous };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['record', recordId], context.previous);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency with server
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => createTag(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const transcribeMutation = useMutation({
    mutationFn: () => triggerTranscribe(recordId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    },
  });

  const summarizeMutation = useMutation({
    mutationFn: () => triggerSummarize(recordId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    },
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => deleteAudio(recordId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
    },
  });

  const deleteRecordMutation = useMutation({
    mutationFn: () => deleteRecord(recordId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      onClose();
    },
  });

  const handlePlayPause = (): void => {
    wavesurferRef.current?.playPause();
  };

  const handleAddTag = async (tagId: number): Promise<void> => {
    if (!record) return;
    const currentIds = record.tags.map((t) => t.id);
    if (currentIds.includes(tagId)) return;
    try {
      await tagsMutation.mutateAsync([...currentIds, tagId]);
      setTagSearch('');
      setShowTagDropdown(false);
    } catch (_e) {
      // Error is handled by react-query's onError / error state
    }
  };

  const handleRemoveTag = async (tagId: number): Promise<void> => {
    if (!record) return;
    const newIds = record.tags.filter((t) => t.id !== tagId).map((t) => t.id);
    try {
      await tagsMutation.mutateAsync(newIds);
    } catch (_e) {
      // Error is handled by react-query's onError / error state
    }
  };

  const handleCreateAndAddTag = async (): Promise<void> => {
    if (!tagSearch.trim()) return;
    try {
      const newTag = await createTagMutation.mutateAsync(tagSearch.trim());
      await handleAddTag(newTag.id);
    } catch (_e) {
      // Error is handled by react-query's onError / error state
    }
  };

  const filteredTags = allTags.filter(
    (t) =>
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !record?.tags.some((rt) => rt.id === t.id),
  );

  const showCreateOption =
    tagSearch.trim() &&
    !allTags.some((t) => t.name.toLowerCase() === tagSearch.toLowerCase());

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Record not found</p>
      </div>
    );
  }

  const displayName = record.display_name ?? record.original_name;
  const recordedDate = new Date(record.recorded_at * 1000);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground truncate">{displayName}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {format(recordedDate, 'MMM d, yyyy HH:mm')}
            </span>
            <DurationDisplay seconds={record.duration_seconds} />
            <StatusBadge status={record.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-accent transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Audio Player */}
        {!record.audio_deleted ? (
          <div className="space-y-2">
            <div ref={waveformRef} className="w-full" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePlayPause}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <Volume2 className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-muted-foreground text-sm">
            <Volume2 className="w-4 h-4" />
            Audio file deleted
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-border">
          <nav className="flex gap-4" role="tablist">
            {[
              { id: 'transcription' as TabId, label: 'Transcription', icon: FileText },
              { id: 'summary' as TabId, label: 'Summary & Notes', icon: Sparkles },
              { id: 'info' as TabId, label: 'Info', icon: Info },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 pb-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'transcription' && (
          <div>
            {record.status === 'transcribing' && (
              <div className="mb-3 p-3 bg-muted/50 rounded-md space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Transcribing...
                  </span>
                  {record.transcription_progress ? (
                    <span className="text-foreground font-medium">
                      {record.transcription_progress.percent}%
                      <span className="text-xs text-muted-foreground ml-1">
                        (chunk {record.transcription_progress.currentChunk}/{record.transcription_progress.totalChunks})
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Uploading...</span>
                  )}
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${record.transcription_progress?.percent ?? 0}%` }}
                  />
                </div>
              </div>
            )}
            {record.transcription ? (
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed p-3 bg-muted/50 rounded-md max-h-80 overflow-y-auto">
                {record.transcription}
              </div>
            ) : record.status !== 'transcribing' ? (
              <p className="text-sm text-muted-foreground italic">No transcription yet.</p>
            ) : null}
          </div>
        )}

        {activeTab === 'summary' && (
          <div>
            {record.summary || record.notes ? (
              <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:marker:text-foreground prose-a:text-primary">
                {record.summary && (
                  <>
                    <h4 className="text-sm font-semibold mb-2">Summary</h4>
                    <ReactMarkdown>{record.summary}</ReactMarkdown>
                  </>
                )}
                {record.notes && (
                  <div className="mt-4">
                    <ReactMarkdown>{record.notes}</ReactMarkdown>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No summary yet.</p>
            )}
          </div>
        )}

        {activeTab === 'info' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Original name:</span>
              <span className="text-foreground font-mono text-xs">{record.original_name}</span>
              <span className="text-muted-foreground">Recorded:</span>
              <span className="text-foreground">{format(recordedDate, 'PPpp')}</span>
              <span className="text-muted-foreground">Duration:</span>
              <DurationDisplay seconds={record.duration_seconds} />
              <span className="text-muted-foreground">Status:</span>
              <StatusBadge status={record.status} />
              {record.transcribed_at && (
                <>
                  <span className="text-muted-foreground">Transcribed:</span>
                  <span className="text-foreground">
                    {format(new Date(record.transcribed_at * 1000), 'PPpp')}
                  </span>
                </>
              )}
              {record.processed_at && (
                <>
                  <span className="text-muted-foreground">Processed:</span>
                  <span className="text-foreground">
                    {format(new Date(record.processed_at * 1000), 'PPpp')}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Tags section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TagIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Tags</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {record.tags.map((tag) => (
              <TagPill key={tag.id} tag={tag} onRemove={(id) => void handleRemoveTag(id)} />
            ))}
          </div>
          {/* Tag autocomplete */}
          <div className="relative">
            <input
              type="text"
              value={tagSearch}
              onChange={(e) => {
                setTagSearch(e.target.value);
                setShowTagDropdown(true);
              }}
              onFocus={() => setShowTagDropdown(true)}
              onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
              placeholder="Add tag..."
              className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {showTagDropdown && (filteredTags.length > 0 || showCreateOption) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
                {filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={() => void handleAddTag(tag.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-1"
                  >
                    {tag.parent_id != null && tag.parent_name && (
                      <>
                        <span className="text-muted-foreground">{tag.parent_name}</span>
                        <span className="text-muted-foreground/60">›</span>
                      </>
                    )}
                    <span>{tag.name}</span>
                  </button>
                ))}
                {showCreateOption && (
                  <button
                    type="button"
                    onMouseDown={() => void handleCreateAndAddTag()}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-primary font-medium"
                  >
                    + Create "{tagSearch}"
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rename section */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">Rename</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="Add suffix..."
              className="flex-1 px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => void renameMutation.mutate()}
              disabled={!suffix.trim() || renameMutation.isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex flex-wrap gap-2">
            {!record.audio_deleted && (
              <button
                type="button"
                onClick={() => void transcribeMutation.mutate()}
                disabled={transcribeMutation.isPending || ['transcribing', 'processing'].includes(record.status)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {transcribeMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                Transcribe now
              </button>
            )}
            <button
              type="button"
              onClick={() => void summarizeMutation.mutate()}
              disabled={
                summarizeMutation.isPending ||
                !record.transcription ||
                record.remaining_today === 0 ||
                ['transcribing', 'processing'].includes(record.status)
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {summarizeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Summarize now
              {record.remaining_today !== undefined && (
                <span className="text-xs opacity-75">({record.remaining_today} left)</span>
              )}
            </button>
            <a
              href={getExportUrl(record.id)}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export MD
            </a>
          </div>

          <div className="flex gap-2">
            {!record.audio_deleted && (
              <button
                type="button"
                onClick={() =>
                  setConfirmDialog({
                    open: true,
                    title: 'Delete audio file?',
                    description:
                      'The audio file will be permanently deleted. Transcription and summary will be preserved.',
                    onConfirm: () => {
                      void deleteAudioMutation.mutate();
                      setConfirmDialog((d) => ({ ...d, open: false }));
                    },
                  })
                }
                disabled={deleteAudioMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete audio
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setConfirmDialog({
                  open: true,
                  title: 'Delete record?',
                  description:
                    'This will permanently delete the record, audio file, transcription, and summary. This action cannot be undone.',
                  onConfirm: () => {
                    void deleteRecordMutation.mutate();
                    setConfirmDialog((d) => ({ ...d, open: false }));
                  },
                })
              }
              disabled={deleteRecordMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {deleteRecordMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete record
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        {...confirmDialog}
        destructive
        confirmLabel="Delete"
        onCancel={() => setConfirmDialog((d) => ({ ...d, open: false }))}
      />
    </div>
  );
}
