export interface ProjectFolder {
  id: number;
  name: string;
  project_count: number;
  created_at: number;
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

export async function fetchProjectFolders(): Promise<ProjectFolder[]> {
  return handleResponse<ProjectFolder[]>(await fetch(`${BASE_URL}/project-folders`));
}

export async function createProjectFolder(name: string): Promise<ProjectFolder> {
  return handleResponse<ProjectFolder>(
    await fetch(`${BASE_URL}/project-folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function renameProjectFolder(id: number, name: string): Promise<void> {
  await handleResponse<unknown>(
    await fetch(`${BASE_URL}/project-folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
}

// The folder's projects are kept; they just end up outside any folder.
export async function deleteProjectFolder(id: number): Promise<void> {
  return handleResponse<void>(await fetch(`${BASE_URL}/project-folders/${id}`, { method: 'DELETE' }));
}
