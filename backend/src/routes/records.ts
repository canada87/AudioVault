import * as fs from 'fs';
import * as path from 'path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, or, gte, lte, inArray, like, desc, asc, sql } from 'drizzle-orm';
import db, { sqlite } from '../db';
import { records, tags, recordTags } from '../db/schema';
import { deleteAudioFile, deleteRecord, renameAudioFile } from '../services/file';
import { enqueueTranscription } from '../scheduler/transcription';
import { processSummary } from '../scheduler/summarizer';
import { getRemainingToday } from '../services/limits';
import { getTranscriptionProgress } from '../services/stt';

interface PaginatedQuery {
  page?: number;
  limit?: number;
  search?: string;
  tags?: string;
  tagMode?: 'or' | 'and';
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface PatchRecordBody {
  suffix?: string;
  tagIds?: number[];
}

interface RecordWithTags {
  id: number;
  original_name: string;
  display_name: string | null;
  recorded_at: number;
  file_path: string;
  audio_deleted: number;
  transcription: string | null;
  summary: string | null;
  notes: string | null;
  status: string;
  transcribed_at: number | null;
  processed_at: number | null;
  duration_seconds: number | null;
  created_at: number;
  updated_at: number;
  tags: Array<{ id: number; name: string }>;
  remaining_today?: number;
  transcription_progress?: { currentChunk: number; totalChunks: number; percent: number } | null;
}

async function getRecordWithTags(recordId: number): Promise<RecordWithTags | null> {
  const [record] = await db.select().from(records).where(eq(records.id, recordId));
  if (!record) return null;

  const tagRows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .innerJoin(recordTags, eq(tags.id, recordTags.tag_id))
    .where(eq(recordTags.record_id, recordId));

  const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);
  const remaining = await getRemainingToday(dailyLimit);

  const result: RecordWithTags = { ...record, tags: tagRows, remaining_today: remaining };
  if (record.status === 'transcribing') {
    result.transcription_progress = getTranscriptionProgress();
  }
  return result;
}

export async function registerRecordRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/records
  app.get('/api/records', async (req: FastifyRequest<{ Querystring: PaginatedQuery }>, reply: FastifyReply) => {
    const {
      page = 1,
      limit = 20,
      search,
      tags: tagFilter,
      tagMode = 'or',
      status,
      dateFrom,
      dateTo,
      q,
      sortBy = 'recorded_at',
      sortOrder = 'desc',
    } = req.query;

    const offset = (page - 1) * limit;

    // FTS search if q provided
    if (q) {
      interface FTSRow { rowid: number }
      let ftsRows: FTSRow[];
      try {
        ftsRows = sqlite.prepare(
          `SELECT rowid FROM records_fts WHERE records_fts MATCH ? LIMIT 200`,
        ).all(q) as FTSRow[];
      } catch (_e) {
        return reply.status(400).send({ error: 'Invalid search query', statusCode: 400 });
      }
      const ids = ftsRows.map((r) => r.rowid);

      if (ids.length === 0) {
        return reply.send({ data: [], total: 0, page, limit });
      }

      const results = await db
        .select()
        .from(records)
        .where(inArray(records.id, ids))
        .limit(limit)
        .offset(offset);

      const withTags = await Promise.all(results.map((r) => getRecordWithTags(r.id)));
      return reply.send({ data: withTags.filter(Boolean), total: ids.length, page, limit });
    }

    // Build conditions
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          like(records.original_name, `%${search}%`),
          like(records.display_name, `%${search}%`),
        )!,
      );
    }

    if (status) {
      const statusList = status.split(',');
      conditions.push(
        inArray(
          records.status,
          statusList as Array<'pending' | 'transcribing' | 'transcribed' | 'processing' | 'done' | 'error'>,
        ),
      );
    }

    if (dateFrom) {
      const ts = new Date(dateFrom).getTime();
      if (isNaN(ts)) {
        return reply.status(400).send({ error: 'Invalid dateFrom', statusCode: 400 });
      }
      conditions.push(gte(records.recorded_at, Math.floor(ts / 1000)));
    }

    if (dateTo) {
      const ts = new Date(dateTo).getTime();
      if (isNaN(ts)) {
        return reply.status(400).send({ error: 'Invalid dateTo', statusCode: 400 });
      }
      conditions.push(lte(records.recorded_at, Math.floor(ts / 1000)));
    }

    // Tag filter
    if (tagFilter) {
      const tagIds = tagFilter.split(',').map(Number).filter(Boolean);
      if (tagIds.length > 0) {
        let recordIds: number[];
        if (tagMode === 'and' && tagIds.length > 1) {
          // AND mode: records must have ALL selected tags
          const rows = await db
            .select({ record_id: recordTags.record_id })
            .from(recordTags)
            .where(inArray(recordTags.tag_id, tagIds))
            .groupBy(recordTags.record_id)
            .having(sql`count(distinct ${recordTags.tag_id}) = ${tagIds.length}`);
          recordIds = rows.map((r) => r.record_id);
        } else {
          // OR mode: records with ANY of the selected tags
          const rows = await db
            .selectDistinct({ record_id: recordTags.record_id })
            .from(recordTags)
            .where(inArray(recordTags.tag_id, tagIds));
          recordIds = rows.map((r) => r.record_id);
        }
        if (recordIds.length === 0) {
          return reply.send({ data: [], total: 0, page, limit });
        }
        conditions.push(inArray(records.id, recordIds));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(records)
      .where(whereClause);
    const total = countResult?.count ?? 0;

    // Order
    const orderCol = sortBy === 'recorded_at' ? records.recorded_at
      : sortBy === 'status' ? records.status
      : records.original_name;
    const orderFn = sortOrder === 'asc' ? asc : desc;

    const results = await db
      .select()
      .from(records)
      .where(whereClause)
      .orderBy(orderFn(orderCol))
      .limit(limit)
      .offset(offset);

    const withTags = await Promise.all(results.map((r) => getRecordWithTags(r.id)));

    return reply.send({ data: withTags.filter(Boolean), total, page, limit });
  });

  // GET /api/records/:id
  app.get('/api/records/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);
    const record = await getRecordWithTags(id);
    if (!record) {
      return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
    }
    return reply.send(record);
  });

  // PATCH /api/records/:id
  app.patch(
    '/api/records/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: PatchRecordBody }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid record ID', statusCode: 400 });
      }
      const { suffix, tagIds } = req.body;

      // Validate input
      if (suffix !== undefined && typeof suffix !== 'string') {
        return reply.status(400).send({ error: 'suffix must be a string', statusCode: 400 });
      }
      if (tagIds !== undefined && (!Array.isArray(tagIds) || !tagIds.every((id) => typeof id === 'number'))) {
        return reply.status(400).send({ error: 'tagIds must be an array of numbers', statusCode: 400 });
      }

      const [existingRecord] = await db.select().from(records).where(eq(records.id, id));
      if (!existingRecord) {
        return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
      }

      if (suffix !== undefined) {
        await renameAudioFile(id, suffix);
      }

      if (tagIds !== undefined) {
        // Replace all tags in a transaction to prevent partial state
        await db.transaction(async (tx) => {
          await tx.delete(recordTags).where(eq(recordTags.record_id, id));
          if (tagIds.length > 0) {
            await tx.insert(recordTags).values(tagIds.map((tid) => ({ record_id: id, tag_id: tid })));
          }
        });
        // Update updated_at after tag change
        await db
          .update(records)
          .set({ updated_at: Math.floor(Date.now() / 1000) })
          .where(eq(records.id, id));
      }

      const updated = await getRecordWithTags(id);
      return reply.send(updated);
    },
  );

  // DELETE /api/records/:id
  app.delete('/api/records/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);
    const [existing] = await db.select().from(records).where(eq(records.id, id));
    if (!existing) {
      return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
    }
    await deleteRecord(id);
    return reply.status(204).send();
  });

  // DELETE /api/records/:id/audio
  app.delete(
    '/api/records/:id/audio',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(records).where(eq(records.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
      }
      await deleteAudioFile(id);
      return reply.status(204).send();
    },
  );

  // POST /api/records/:id/transcribe
  app.post(
    '/api/records/:id/transcribe',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      const [record] = await db.select().from(records).where(eq(records.id, id));
      if (!record) {
        return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
      }
      if (record.audio_deleted) {
        return reply.status(400).send({ error: 'Audio file has been deleted', statusCode: 400 });
      }
      if (['transcribing', 'processing'].includes(record.status)) {
        return reply.status(409).send({ error: 'Record is already being processed', statusCode: 409 });
      }

      // Enqueue (processed sequentially — Parakeet is single-job)
      enqueueTranscription(id, record.file_path, 'manual', app.log);

      return reply.status(202).send({ message: 'Transcription queued' });
    },
  );

  // POST /api/records/:id/summarize
  app.post(
    '/api/records/:id/summarize',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      const [record] = await db.select().from(records).where(eq(records.id, id));
      if (!record) {
        return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
      }
      if (!record.transcription) {
        return reply.status(400).send({ error: 'Record has no transcription', statusCode: 400 });
      }
      if (['transcribing', 'processing'].includes(record.status)) {
        return reply.status(409).send({ error: 'Record is already being processed', statusCode: 409 });
      }

      processSummary(id, record.transcription, 'manual', app.log).catch((err: unknown) => {
        app.log.error({ err, recordId: id }, 'Manual summarization failed');
      });

      return reply.status(202).send({ message: 'Summarization started' });
    },
  );

  // GET /api/records/:id/export
  app.get(
    '/api/records/:id/export',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      const record = await getRecordWithTags(id);
      if (!record) {
        return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
      }

      const date = new Date(record.recorded_at * 1000).toISOString().split('T')[0];
      const title = record.display_name ?? record.original_name;
      const tagList = record.tags.map((t) => t.name).join(', ');

      let markdown = `# ${title}\n\n`;
      markdown += `**Date:** ${date}\n`;
      markdown += `**Duration:** ${record.duration_seconds ? `${Math.floor(record.duration_seconds / 60)}m ${record.duration_seconds % 60}s` : 'Unknown'}\n`;
      markdown += `**Status:** ${record.status}\n`;
      if (tagList) markdown += `**Tags:** ${tagList}\n`;
      markdown += '\n---\n\n';

      if (record.summary) {
        markdown += `## Summary\n\n${record.summary}\n\n`;
      }

      if (record.notes) {
        markdown += `${record.notes}\n\n`;
      }

      if (record.transcription) {
        markdown += `## Transcription\n\n${record.transcription}\n`;
      }

      const filename = `${date}-${title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;

      return reply
        .header('Content-Type', 'text/markdown')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(markdown);
    },
  );

  // POST /api/records/import-transcriptions
  const TXT_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})(?: - (.+))?\.txt$/;

  app.post(
    '/api/records/import-transcriptions',
    async (req: FastifyRequest<{ Body: { directory: string } }>, reply: FastifyReply) => {
      const { directory } = req.body;
      if (!directory || typeof directory !== 'string') {
        return reply.status(400).send({ error: 'directory is required', statusCode: 400 });
      }

      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        return reply.status(400).send({ error: 'Directory does not exist', statusCode: 400 });
      }

      const files = fs.readdirSync(dir).filter((f) => TXT_PATTERN.test(f));
      if (files.length === 0) {
        return reply.send({ imported: 0, skipped: 0, errors: [] });
      }

      let imported = 0;
      let skipped = 0;
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        try {
          const match = TXT_PATTERN.exec(file);
          if (!match) continue;

          const dateStr = match[1]; // "YYYY-MM-DD HH-MM-SS"
          const namePart = match[2] ?? null; // "nome - dettagli" or null

          // Parse timestamp: "YYYY-MM-DD HH-MM-SS" → "YYYY-MM-DDTHH:MM:SS"
          const isoString = dateStr.replace(' ', 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
          const recorded_at = Math.floor(new Date(isoString).getTime() / 1000);

          if (isNaN(recorded_at)) {
            errors.push({ file, error: 'Invalid date in filename' });
            continue;
          }

          const filePath = path.resolve(dir, file).replace(/\\/g, '/');

          // Deduplicate by original_name
          const existing = await db
            .select({ id: records.id })
            .from(records)
            .where(eq(records.original_name, file));

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          const transcription = fs.readFileSync(path.join(dir, file), 'utf-8');

          await db.insert(records).values({
            original_name: file,
            display_name: namePart,
            recorded_at,
            file_path: filePath,
            audio_deleted: 1,
            status: 'transcribed',
            transcription,
            transcribed_at: Math.floor(Date.now() / 1000),
            duration_seconds: null,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
          });

          imported++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ file, error: msg });
        }
      }

      app.log.info({ imported, skipped, errors: errors.length }, 'Transcription import completed');
      return reply.send({ imported, skipped, errors });
    },
  );

  // POST /api/browse-directory
  app.post(
    '/api/browse-directory',
    async (req: FastifyRequest<{ Body: { directory?: string } }>, reply: FastifyReply) => {
      const requested = req.body?.directory?.trim();

      // Default starting points
      if (!requested) {
        // Return drive roots on Windows, / on Unix
        if (process.platform === 'win32') {
          // List available drive letters
          const drives: Array<{ name: string; path: string; type: 'directory' }> = [];
          for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            const drivePath = `${letter}:\\`;
            try {
              fs.accessSync(drivePath);
              drives.push({ name: `${letter}:`, path: drivePath, type: 'directory' });
            } catch {
              // Drive doesn't exist
            }
          }
          return reply.send({ current: '', parent: null, entries: drives });
        }
        return reply.send({
          current: '/',
          parent: null,
          entries: listDirectoryEntries('/'),
        });
      }

      const dir = path.resolve(requested);
      if (!fs.existsSync(dir)) {
        return reply.status(400).send({ error: 'Directory does not exist', statusCode: 400 });
      }

      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: 'Path is not a directory', statusCode: 400 });
      }

      const parent = path.dirname(dir);
      return reply.send({
        current: dir.replace(/\\/g, '/'),
        parent: parent !== dir ? parent.replace(/\\/g, '/') : null,
        entries: listDirectoryEntries(dir),
      });
    },
  );
}

function listDirectoryEntries(dir: string): Array<{ name: string; path: string; type: 'directory' | 'file' }> {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    return items
      .filter((item) => {
        // Skip hidden files/folders
        if (item.name.startsWith('.')) return false;
        return item.isDirectory() || item.name.endsWith('.txt');
      })
      .map((item) => ({
        name: item.name,
        path: path.join(dir, item.name).replace(/\\/g, '/'),
        type: (item.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
      }))
      .sort((a, b) => {
        // Directories first, then files
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}
