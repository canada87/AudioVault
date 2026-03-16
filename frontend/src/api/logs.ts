const BASE_URL = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface LogEntry {
  id: number;
  level: number;
  levelLabel: string;
  msg: string;
  time: number;
  [key: string]: unknown;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
}

export async function fetchLogs(params?: {
  level?: string;
  since?: number;
  limit?: number;
}): Promise<LogsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.level) searchParams.set('level', params.level);
  if (params?.since) searchParams.set('since', String(params.since));
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const qs = searchParams.toString();
  const res = await fetch(`${BASE_URL}/logs${qs ? `?${qs}` : ''}`);
  return handleResponse<LogsResponse>(res);
}

export async function clearLogs(): Promise<void> {
  const res = await fetch(`${BASE_URL}/logs`, { method: 'DELETE' });
  await handleResponse<{ ok: boolean }>(res);
}
