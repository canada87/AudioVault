import * as fs from 'fs';
import * as path from 'path';

// Project documents are stored next to the SQLite file (which is the persistent/mounted volume in
// Docker): <data dir>/project-documents/<project id>/<random name>.<ext>

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

// Allowed extensions and the Content-Type they are always served with. Extension is the source of
// truth because browsers report inconsistent MIME types for Office files.
export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function allowedExtensionsLabel(): string {
  return Object.keys(DOCUMENT_TYPES).join(', ');
}

export function projectDocumentsDir(projectId: number): string {
  const dataDir = path.dirname(path.resolve(process.env['DB_PATH'] ?? './data/audiovault.db'));
  return path.join(dataDir, 'project-documents', String(projectId));
}

// The name is only ever displayed, never used as a path: keep just the basename, drop control chars.
export function cleanDocumentName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = path.basename(raw.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base.slice(0, 255);
}

export async function removeProjectDocumentsDir(projectId: number): Promise<void> {
  await fs.promises.rm(projectDocumentsDir(projectId), { recursive: true, force: true });
}
