export interface Tag {
  id: number;
  name: string;
}

export interface AudioRecord {
  id: number;
  original_name: string;
  display_name: string | null;
  recorded_at: number;
  file_path: string;
  audio_deleted: number;
  transcription: string | null;
  summary: string | null;
  notes: string | null;
  status: 'pending' | 'transcribing' | 'transcribed' | 'processing' | 'done' | 'error';
  transcribed_at: number | null;
  processed_at: number | null;
  duration_seconds: number | null;
  created_at: number;
  updated_at: number;
  tags: Tag[];
  remaining_today?: number;
  transcription_progress?: { currentChunk: number; totalChunks: number; percent: number } | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface RecordsQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  tags?: string;
  tagMode?: 'or' | 'and';
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

const BASE_URL = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function fetchRecords(params: RecordsQueryParams = {}): Promise<PaginatedResponse<AudioRecord>> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') query.set(k, String(v));
  });
  const res = await fetch(`${BASE_URL}/records?${query.toString()}`);
  return handleResponse<PaginatedResponse<AudioRecord>>(res);
}

export async function fetchRecord(id: number): Promise<AudioRecord> {
  const res = await fetch(`${BASE_URL}/records/${id}`);
  return handleResponse<AudioRecord>(res);
}

export async function patchRecord(
  id: number,
  body: { suffix?: string; tagIds?: number[] },
): Promise<AudioRecord> {
  const res = await fetch(`${BASE_URL}/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<AudioRecord>(res);
}

export async function deleteRecord(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/records/${id}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

export async function deleteAudio(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/records/${id}/audio`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

export async function triggerTranscribe(id: number): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/records/${id}/transcribe`, { method: 'POST' });
  return handleResponse<{ message: string }>(res);
}

export async function triggerSummarize(id: number): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/records/${id}/summarize`, { method: 'POST' });
  return handleResponse<{ message: string }>(res);
}

export function getExportUrl(id: number): string {
  return `${BASE_URL}/records/${id}/export`;
}

export function getAudioUrl(id: number): string {
  return `${BASE_URL}/audio/${id}`;
}

export interface ScanResult {
  added: number;
  scanned: number;
}

export async function scanAudioDirectory(): Promise<ScanResult> {
  const res = await fetch(`${BASE_URL}/records/scan`, { method: 'POST' });
  return handleResponse<ScanResult>(res);
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

export async function importTranscriptions(directory: string): Promise<ImportResult> {
  const res = await fetch(`${BASE_URL}/records/import-transcriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory }),
  });
  return handleResponse<ImportResult>(res);
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

export async function browseDirectory(directory?: string): Promise<BrowseResult> {
  const res = await fetch(`${BASE_URL}/browse-directory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: directory ?? '' }),
  });
  return handleResponse<BrowseResult>(res);
}
