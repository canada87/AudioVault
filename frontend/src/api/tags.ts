import type { Tag } from './records';

export interface TagWithCount extends Tag {
  record_count: number;
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

export async function fetchTags(): Promise<TagWithCount[]> {
  const res = await fetch(`${BASE_URL}/tags`);
  return handleResponse<TagWithCount[]>(res);
}

export async function createTag(name: string): Promise<TagWithCount> {
  const res = await fetch(`${BASE_URL}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse<TagWithCount>(res);
}

export async function patchTag(id: number, name: string): Promise<Tag> {
  const res = await fetch(`${BASE_URL}/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse<Tag>(res);
}

export async function deleteTag(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/tags/${id}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}
