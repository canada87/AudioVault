import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import db from '../db';
import { records, processingLog } from '../db/schema';
import { transcribeAudio } from '../services/stt';
import type { FastifyBaseLogger } from 'fastify';

// ── Transcription queue (Parakeet is single-job) ──────────────────────
interface QueueItem {
  recordId: number;
  filePath: string;
  triggeredBy: 'scheduler' | 'manual';
}

const queue: QueueItem[] = [];
let processing = false;
let _logger: FastifyBaseLogger | null = null;

/**
 * Enqueue a transcription request.
 * If nothing is currently processing, it starts immediately.
 * Otherwise it waits in line.
 */
export function enqueueTranscription(
  recordId: number,
  filePath: string,
  triggeredBy: 'scheduler' | 'manual',
  logger: FastifyBaseLogger,
): void {
  _logger = logger;

  // Don't enqueue duplicates
  if (queue.some((item) => item.recordId === recordId)) {
    logger.info({ recordId }, 'Transcription already queued, skipping');
    return;
  }

  queue.push({ recordId, filePath, triggeredBy });
  logger.info({ recordId, queueLength: queue.length }, 'Transcription enqueued');

  // Kick off the drain loop if not already running
  if (!processing) {
    drainQueue().catch((err: unknown) => {
      logger.error({ err }, 'Transcription queue drain failed');
    });
  }
}

/** Returns the current queue length (excluding the item being processed). */
export function getQueueLength(): number {
  return queue.length;
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift()!;
    await processTranscription(item.recordId, item.filePath, item.triggeredBy, _logger!);
  }

  processing = false;
}

// ── Cron scheduler ────────────────────────────────────────────────────

export function startTranscriptionScheduler(logger: FastifyBaseLogger): void {
  _logger = logger;
  const cronExpression = process.env['TRANSCRIPTION_CRON'] ?? '0 4 * * *';

  if (!cron.validate(cronExpression)) {
    logger.error({ cronExpression }, 'Invalid TRANSCRIPTION_CRON expression');
    return;
  }

  cron.schedule(cronExpression, () => {
    logger.info('Transcription scheduler triggered');
    runTranscriptionBatch(logger).catch((err: unknown) => {
      logger.error({ err }, 'Transcription batch failed');
    });
  });

  logger.info({ cronExpression }, 'Transcription scheduler started');
}

export async function runTranscriptionBatch(logger: FastifyBaseLogger): Promise<void> {
  // Fetch pending records that have audio files
  const pendingRecords = await db
    .select()
    .from(records)
    .where(eq(records.status, 'pending'));

  const eligible = pendingRecords.filter((r) => !r.audio_deleted);

  if (eligible.length === 0) {
    logger.info('No pending records to transcribe');
    return;
  }

  logger.info({ count: eligible.length }, 'Starting transcription batch');

  for (const record of eligible) {
    enqueueTranscription(record.id, record.file_path, 'scheduler', logger);
  }
}

// ── Core processing (called only from the queue) ──────────────────────

export async function processTranscription(
  recordId: number,
  filePath: string,
  triggeredBy: 'scheduler' | 'manual',
  logger: FastifyBaseLogger,
): Promise<void> {
  logger.info({ recordId }, 'Starting transcription');

  // Set status to transcribing
  await db
    .update(records)
    .set({ status: 'transcribing', updated_at: Math.floor(Date.now() / 1000) })
    .where(eq(records.id, recordId));

  try {
    const transcription = await transcribeAudio(filePath);

    await db
      .update(records)
      .set({
        status: 'transcribed',
        transcription,
        transcribed_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(records.id, recordId));

    await db.insert(processingLog).values({
      record_id: recordId,
      action: 'transcription',
      triggered_by: triggeredBy,
      status: 'success',
      created_at: Math.floor(Date.now() / 1000),
    });

    logger.info({ recordId }, 'Transcription completed successfully');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ recordId, error: errorMsg }, 'Transcription failed');

    try {
      await db
        .update(records)
        .set({ status: 'error', updated_at: Math.floor(Date.now() / 1000) })
        .where(eq(records.id, recordId));

      await db.insert(processingLog).values({
        record_id: recordId,
        action: 'transcription',
        triggered_by: triggeredBy,
        status: 'error',
        error_msg: errorMsg,
        created_at: Math.floor(Date.now() / 1000),
      });
    } catch (dbError) {
      logger.error({ recordId, dbError }, 'Failed to update error status in DB');
    }
  }
}
