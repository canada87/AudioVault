export interface ProjectDocument {
  id: number;
  project_id: number;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

// Mirrors the backend whitelist (backend/src/services/documents.ts), which stays authoritative;
// checking here only gives instant feedback before a large upload starts.
export const DOCUMENT_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.gif', '.webp',
] as const;
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

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

export async function fetchProjectDocuments(projectId: number): Promise<ProjectDocument[]> {
  return handleResponse<ProjectDocument[]>(await fetch(`${BASE_URL}/projects/${projectId}/documents`));
}

export async function uploadProjectDocument(projectId: number, file: File): Promise<ProjectDocument> {
  const body = new FormData();
  body.append('file', file, file.name);
  return handleResponse<ProjectDocument>(
    await fetch(`${BASE_URL}/projects/${projectId}/documents`, { method: 'POST', body }),
  );
}

export async function deleteProjectDocument(projectId: number, docId: number): Promise<void> {
  return handleResponse<void>(
    await fetch(`${BASE_URL}/projects/${projectId}/documents/${docId}`, { method: 'DELETE' }),
  );
}

// The server answers with Content-Disposition: attachment, so a plain link downloads the file.
export function documentDownloadUrl(projectId: number, docId: number): string {
  return `${BASE_URL}/projects/${projectId}/documents/${docId}/download`;
}
