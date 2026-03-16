import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import db from '../db';
import { records, processingLog } from '../db/schema';
import { transcribeAudio } from '../services/stt';
import type { FastifyBaseLogger } from 'fastify';

export function startTranscriptionScheduler(logger: FastifyBaseLogger): void {
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

  // Process sequentially
  for (const record of eligible) {
    await processTranscription(record.id, record.file_path, 'scheduler', logger);
  }
}

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
