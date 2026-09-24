export type ProjectTagMode = 'or' | 'and';

export interface ProjectTag {
  id: number;
  name: string;
}

export interface ProjectRecord {
  id: number;
  recorded_at: number;
  display_name: string | null;
  original_name: string;
  summary: string | null;
}

export interface ProjectSummary {
  id: number;
  title: string;
  tag_mode: ProjectTagMode;
  tags: ProjectTag[];
  included_count: number;
  pending_count: number;
  excluded_count: number;
  report_period_start: number | null;
  report_period_end: number | null;
  last_generated_at: number | null;
  last_error: string | null;
  has_report: boolean;
  created_at: number;
  updated_at: number;
}

export interface ProjectDetail {
  id: number;
  title: string;
  tag_mode: ProjectTagMode;
  report: string | null;
  report_period_start: number | null;
  report_period_end: number | null;
  last_generated_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  tags: ProjectTag[];
  included: ProjectRecord[];
  excluded: ProjectRecord[];
  pending: ProjectRecord[];
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

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${BASE_URL}/projects`);
  return handleResponse<ProjectSummary[]>(res);
}

export async function fetchProject(id: number): Promise<ProjectDetail> {
  const res = await fetch(`${BASE_URL}/projects/${id}`);
  return handleResponse<ProjectDetail>(res);
}

export async function createProject(body: {
  title: string;
  tag_ids: number[];
  tag_mode?: ProjectTagMode;
}): Promise<ProjectDetail> {
  const res = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<ProjectDetail>(res);
}

export async function patchProject(
  id: number,
  body: { title?: string; tag_ids?: number[]; tag_mode?: ProjectTagMode; report?: string | null },
): Promise<ProjectDetail> {
  const res = await fetch(`${BASE_URL}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<ProjectDetail>(res);
}

export async function deleteProject(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/projects/${id}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

export async function generateProject(id: number): Promise<ProjectDetail> {
  const res = await fetch(`${BASE_URL}/projects/${id}/generate`, { method: 'POST' });
  return handleResponse<ProjectDetail>(res);
}

export async function regenerateProject(id: number, recordIds: number[]): Promise<ProjectDetail> {
  const res = await fetch(`${BASE_URL}/projects/${id}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record_ids: recordIds }),
  });
  return handleResponse<ProjectDetail>(res);
}
