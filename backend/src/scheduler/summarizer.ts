import { eq, isNull } from 'drizzle-orm';
import db from '../db';
import { records, processingLog } from '../db/schema';
import { generateSummary } from '../services/llm';
import { canProcessToday, incrementToday } from '../services/limits';
import type { FastifyBaseLogger } from 'fastify';

let pollerInterval: ReturnType<typeof setInterval> | null = null;

export function startSummarizerPoller(logger: FastifyBaseLogger): void {
  const pollIntervalMinutes = parseInt(process.env['LLM_POLL_INTERVAL'] ?? '30', 10);
  const pollIntervalMs = pollIntervalMinutes * 60 * 1000;

  // Run once at startup after a short delay
  setTimeout(() => {
    runSummarizerBatch(logger).catch((err: unknown) => {
      logger.error({ err }, 'Summarizer initial run failed');
    });
  }, 10000);

  pollerInterval = setInterval(() => {
    runSummarizerBatch(logger).catch((err: unknown) => {
      logger.error({ err }, 'Summarizer poll failed');
    });
  }, pollIntervalMs);

  logger.info({ pollIntervalMinutes }, 'Summarizer poller started');
}

export function stopSummarizerPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

export async function runSummarizerBatch(logger: FastifyBaseLogger): Promise<void> {
  const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);

  // Fetch transcribed records with no processed_at
  const transcribedRecords = await db
    .select()
    .from(records)
    .where(eq(records.status, 'transcribed'));

  const eligible = transcribedRecords.filter((r) => r.processed_at === null);

  if (eligible.length === 0) {
    return;
  }

  logger.info({ count: eligible.length }, 'Starting summarizer batch');

  for (const record of eligible) {
    const canProcess = await canProcessToday(dailyLimit);
    if (!canProcess) {
      logger.info('Daily LLM limit reached, stopping summarizer batch');
      break;
    }

    await processSummary(record.id, record.transcription ?? '', 'scheduler', logger);
  }
}

export async function processSummary(
  recordId: number,
  transcription: string,
  triggeredBy: 'scheduler' | 'manual',
  logger: FastifyBaseLogger,
): Promise<void> {
  const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);

  if (triggeredBy === 'manual') {
    const canProcess = await canProcessToday(dailyLimit);
    if (!canProcess) {
      throw new Error('Daily LLM limit reached');
    }
  }

  logger.info({ recordId }, 'Starting summarization');

  // Set status to processing
  await db
    .update(records)
    .set({ status: 'processing', updated_at: Math.floor(Date.now() / 1000) })
    .where(eq(records.id, recordId));

  try {
    const { summary, notes } = await generateSummary(transcription);

    await db
      .update(records)
      .set({
        status: 'done',
        summary,
        notes,
        processed_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(records.id, recordId));

    await incrementToday();

    await db.insert(processingLog).values({
      record_id: recordId,
      action: 'summary',
      triggered_by: triggeredBy,
      status: 'success',
      created_at: Math.floor(Date.now() / 1000),
    });

    logger.info({ recordId }, 'Summarization completed successfully');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ recordId, error: errorMsg }, 'Summarization failed');

    try {
      await db
        .update(records)
        .set({ status: 'error', updated_at: Math.floor(Date.now() / 1000) })
        .where(eq(records.id, recordId));

      await db.insert(processingLog).values({
        record_id: recordId,
        action: 'summary',
        triggered_by: triggeredBy,
        status: 'error',
        error_msg: errorMsg,
        created_at: Math.floor(Date.now() / 1000),
      });
    } catch (dbError) {
      logger.error({ recordId, dbError }, 'Failed to update error status in DB');
    }

    throw error;
  }
}

// Suppress unused import warning
void isNull;
