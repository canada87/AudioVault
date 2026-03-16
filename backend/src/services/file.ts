import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import db from '../db';
import { records } from '../db/schema';

export async function renameAudioFile(
  recordId: number,
  suffix: string,
): Promise<{ display_name: string; file_path: string }> {
  const [record] = await db.select().from(records).where(eq(records.id, recordId));
  if (!record) {
    throw new Error(`Record ${recordId} not found`);
  }

  // Sanitize suffix to prevent path traversal
  const sanitized = suffix.trim().replace(/[/\\:*?"<>|]/g, '');
  if (!sanitized) {
    throw new Error('Invalid suffix');
  }

  const dir = path.dirname(record.file_path);
  const ext = path.extname(record.original_name);
  const baseName = path.basename(record.original_name, ext);
  const newDisplayName = `${baseName} ${sanitized}${ext}`;
  const newFilePath = path.join(dir, newDisplayName);

  // Verify the resolved path stays within the audio directory
  const resolvedDir = path.resolve(dir);
  const resolvedNew = path.resolve(newFilePath);
  if (!resolvedNew.startsWith(resolvedDir + path.sep) && resolvedNew !== resolvedDir) {
    throw new Error('Invalid suffix: path traversal detected');
  }

  const actualFilePath = record.audio_deleted ? record.file_path : newFilePath;

  if (!record.audio_deleted && fs.existsSync(record.file_path)) {
    fs.renameSync(record.file_path, newFilePath);
  }

  await db
    .update(records)
    .set({
      display_name: newDisplayName,
      file_path: actualFilePath,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .where(eq(records.id, recordId));

  return { display_name: newDisplayName, file_path: actualFilePath };
}

export async function deleteAudioFile(recordId: number): Promise<void> {
  const [record] = await db.select().from(records).where(eq(records.id, recordId));
  if (!record) {
    throw new Error(`Record ${recordId} not found`);
  }

  if (!record.audio_deleted && fs.existsSync(record.file_path)) {
    fs.unlinkSync(record.file_path);
  }

  await db
    .update(records)
    .set({
      audio_deleted: 1,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .where(eq(records.id, recordId));
}

export async function deleteRecord(recordId: number): Promise<void> {
  const [record] = await db.select().from(records).where(eq(records.id, recordId));
  if (!record) {
    throw new Error(`Record ${recordId} not found`);
  }

  if (!record.audio_deleted && fs.existsSync(record.file_path)) {
    try {
      fs.unlinkSync(record.file_path);
    } catch (_e) {
      // File might not exist, continue with DB deletion
    }
  }

  await db.delete(records).where(eq(records.id, recordId));
}

export function getAudioFilePath(filePath: string): string {
  return filePath;
}

export function audioFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
