import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import chokidar from 'chokidar';
import { eq } from 'drizzle-orm';
import db from './db';
import { records } from './db/schema';
import type { FastifyBaseLogger } from 'fastify';

const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mp4|mkv)$/;
const SUPPORTED_EXTENSIONS = ['.mp4', '.mkv'];

function parseRecordedAt(filename: string): number {
  // filename: "YYYY-MM-DD HH-MM-SS.mp4" or ".mkv"
  const withoutExt = filename.replace(/\.(mp4|mkv)$/, '');
  // Convert "YYYY-MM-DD HH-MM-SS" → "YYYY-MM-DDTHH:MM:SS"
  const isoString = withoutExt.replace(' ', 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
  const date = new Date(isoString);
  return Math.floor(date.getTime() / 1000);
}

function getDurationSeconds(filePath: string): number | null {
  try {
    const result = child_process.spawnSync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      filePath,
    ]);

    if (result.status !== 0) {
      return null;
    }

    interface FFProbeOutput {
      format?: {
        duration?: string;
      };
    }

    const output = JSON.parse(result.stdout.toString()) as FFProbeOutput;
    const duration = output.format?.duration;
    if (duration) {
      return Math.round(parseFloat(duration));
    }
    return null;
  } catch (_e) {
    return null;
  }
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}

async function processFile(filePath: string, logger: FastifyBaseLogger): Promise<void> {
  filePath = normalizePath(filePath);
  const filename = path.basename(filePath);

  if (!FILENAME_PATTERN.test(filename)) {
    logger.warn({ filename }, 'File does not match expected pattern, skipping');
    return;
  }

  // Check if already in DB
  const existing = await db
    .select({ id: records.id })
    .from(records)
    .where(eq(records.file_path, filePath));

  if (existing.length > 0) {
    return;
  }

  const recorded_at = parseRecordedAt(filename);
  const duration_seconds = getDurationSeconds(filePath);

  await db.insert(records).values({
    original_name: filename,
    display_name: null,
    recorded_at,
    file_path: filePath,
    audio_deleted: 0,
    status: 'pending',
    duration_seconds,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  });

  logger.info({ filename, recorded_at, duration_seconds }, 'New record added to database');
}

export function startWatcher(logger: FastifyBaseLogger): void {
  const audioDir = process.env['AUDIO_DIR'];
  if (!audioDir) {
    logger.warn('AUDIO_DIR not configured, file watcher disabled');
    return;
  }

  if (!fs.existsSync(audioDir)) {
    logger.warn({ audioDir }, 'AUDIO_DIR does not exist, file watcher disabled');
    return;
  }

  // Initial scan — process sequentially to avoid SQLite contention
  const files = fs.readdirSync(audioDir);
  (async () => {
    for (const file of files) {
      if (SUPPORTED_EXTENSIONS.some((ext) => file.endsWith(ext))) {
        const filePath = path.join(audioDir, file);
        try {
          await processFile(filePath, logger);
        } catch (err: unknown) {
          logger.error({ err, file }, 'Error processing file during initial scan');
        }
      }
    }
    logger.info({ count: files.filter((f) => SUPPORTED_EXTENSIONS.some((ext) => f.endsWith(ext))).length }, 'Initial scan completed');
  })().catch((err: unknown) => {
    logger.error({ err }, 'Initial scan failed');
  });

  // Watch for new files
  const watcher = chokidar.watch(audioDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath: string) => {
    if (SUPPORTED_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
      processFile(filePath, logger).catch((err: unknown) => {
        logger.error({ err, filePath }, 'Error processing new file');
      });
    }
  });

  watcher.on('error', (error: unknown) => {
    logger.error({ error }, 'Watcher error');
  });

  logger.info({ audioDir }, 'File watcher started');
}
