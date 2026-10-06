import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db';
import { projects, projectRecords, records, recordTags, tags } from '../db/schema';
import type { Record as DbRecord } from '../db/schema';
import { generateProjectReport } from './llm';
import { canProcessToday, incrementToday } from './limits';
import {
  TagQueryError,
  collectTagIds,
  emptyTagQuery,
  evaluateTagQuery,
  parseTagQuery,
  pruneTagQuery,
  tagQueryToText,
} from './tagQuery';
import type { TagQueryGroup } from './tagQuery';
import type { FastifyBaseLogger } from 'fastify';

export class ProjectError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function formatMeetingDate(recordedAt: number): string {
  return new Date(recordedAt * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function meetingTitle(record: DbRecord): string {
  return record.display_name ?? record.original_name;
}

// Validates a client-supplied tag query and checks that every referenced tag exists.
export async function parseAndValidateTagQuery(raw: unknown): Promise<TagQueryGroup> {
  const query = parseTagQuery(raw);
  const wanted = [...collectTagIds(query)];
  const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, wanted));
  if (found.length !== wanted.length) {
    const foundIds = new Set(found.map((t) => t.id));
    throw new TagQueryError(`Unknown tag id(s): ${wanted.filter((id) => !foundIds.has(id)).join(', ')}`);
  }
  return query;
}

// Stored query with tags that no longer exist removed, plus its readable form.
async function loadTagQuery(project: typeof projects.$inferSelect): Promise<{ query: TagQueryGroup; text: string }> {
  const tagRows = await db.select({ id: tags.id, name: tags.name }).from(tags);
  const nameById = new Map(tagRows.map((t) => [t.id, t.name]));

  let stored: TagQueryGroup = emptyTagQuery();
  if (project.tag_query) {
    try {
      stored = parseTagQuery(JSON.parse(project.tag_query));
    } catch {
      // Unreadable stored query: behave as "matches nothing" rather than failing the whole project.
    }
  }
  const query = pruneTagQuery(stored, (id) => nameById.has(id));
  return { query, text: tagQueryToText(query, nameById) };
}

// Every record the query matches, flagged by whether it has a usable summary.
async function matchRecords(query: TagQueryGroup): Promise<Array<{ id: number; summarized: boolean }>> {
  const tagsByRecord = new Map<number, Set<number>>();
  for (const row of await db.select().from(recordTags)) {
    const set = tagsByRecord.get(row.record_id) ?? new Set<number>();
    set.add(row.tag_id);
    tagsByRecord.set(row.record_id, set);
  }

  const rows = await db
    .select({ id: records.id, summarized: sql<number>`trim(coalesce(${records.summary}, '')) != ''` })
    .from(records);

  const noTags = new Set<number>();
  return rows
    .filter((r) => evaluateTagQuery(query, tagsByRecord.get(r.id) ?? noTags))
    .map((r) => ({ id: r.id, summarized: Boolean(r.summarized) }));
}

// Records that match the project's tag query and have a non-empty summary.
export async function getEligibleRecords(query: TagQueryGroup): Promise<DbRecord[]> {
  const ids = (await matchRecords(query)).filter((r) => r.summarized).map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = await db.select().from(records).where(inArray(records.id, ids));
  return rows.sort((a, b) => a.recorded_at - b.recorded_at);
}

// Live feedback for the query builder, before anything is saved.
export async function previewTagQuery(
  raw: unknown,
): Promise<{ text: string; total: number; summarized: number }> {
  const query = await parseAndValidateTagQuery(raw);
  const tagRows = await db.select({ id: tags.id, name: tags.name }).from(tags);
  const matched = await matchRecords(query);
  return {
    text: tagQueryToText(query, new Map(tagRows.map((t) => [t.id, t.name]))),
    total: matched.length,
    summarized: matched.filter((r) => r.summarized).length,
  };
}

export interface ProjectDetail {
  project: typeof projects.$inferSelect;
  query: TagQueryGroup;
  queryText: string;
  included: DbRecord[];
  excluded: DbRecord[];
  pending: DbRecord[];
}

export async function getProjectDetail(projectId: number): Promise<ProjectDetail> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    throw new ProjectError('Project not found', 404);
  }

  const { query, text } = await loadTagQuery(project);
  const eligible = await getEligibleRecords(query);

  const stateRows = await db
    .select()
    .from(projectRecords)
    .where(eq(projectRecords.project_id, projectId));
  const stateByRecordId = new Map(stateRows.map((r) => [r.record_id, r.state]));

  const included = eligible.filter((r) => stateByRecordId.get(r.id) === 'included');
  const excluded = eligible.filter((r) => stateByRecordId.get(r.id) === 'excluded');
  const pending = eligible.filter((r) => !stateByRecordId.has(r.id));

  return { project, query, queryText: text, included, excluded, pending };
}

async function recomputePeriod(projectId: number): Promise<{ start: number | null; end: number | null }> {
  const includedIds = await db
    .select({ record_id: projectRecords.record_id })
    .from(projectRecords)
    .where(and(eq(projectRecords.project_id, projectId), eq(projectRecords.state, 'included')));

  if (includedIds.length === 0) {
    return { start: null, end: null };
  }

  const [row] = await db
    .select({
      start: sql<number>`MIN(${records.recorded_at})`,
      end: sql<number>`MAX(${records.recorded_at})`,
    })
    .from(records)
    .where(inArray(records.id, includedIds.map((r) => r.record_id)));

  return { start: row?.start ?? null, end: row?.end ?? null };
}

export async function runIncrementalGenerate(
  projectId: number,
  logger: FastifyBaseLogger,
): Promise<ProjectDetail> {
  const detail = await getProjectDetail(projectId);
  if (detail.pending.length === 0) {
    throw new ProjectError('No new meetings to include');
  }

  const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);
  if (!(await canProcessToday(dailyLimit))) {
    throw new ProjectError('Daily LLM limit reached', 429);
  }

  const meetings = detail.pending.map((r) => ({
    date: formatMeetingDate(r.recorded_at),
    title: meetingTitle(r),
    summary: r.summary ?? '',
  }));

  try {
    const report = await generateProjectReport(detail.project.report, meetings);
    const now = Math.floor(Date.now() / 1000);

    db.transaction((tx) => {
      for (const r of detail.pending) {
        tx.insert(projectRecords)
          .values({ project_id: projectId, record_id: r.id, state: 'included', updated_at: now })
          .run();
      }
    });

    const period = await recomputePeriod(projectId);

    await db
      .update(projects)
      .set({
        report,
        report_period_start: period.start,
        report_period_end: period.end,
        last_generated_at: now,
        last_error: null,
        updated_at: now,
      })
      .where(eq(projects.id, projectId));

    await incrementToday();

    return getProjectDetail(projectId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ projectId, error: errorMsg }, 'Project report generation failed');
    await db
      .update(projects)
      .set({ last_error: errorMsg, updated_at: Math.floor(Date.now() / 1000) })
      .where(eq(projects.id, projectId));
    throw error;
  }
}

export async function runRegenerateFromSelection(
  projectId: number,
  includedRecordIds: number[],
  logger: FastifyBaseLogger,
): Promise<ProjectDetail> {
  const detail = await getProjectDetail(projectId);
  const eligibleIds = new Set([...detail.included, ...detail.excluded, ...detail.pending].map((r) => r.id));

  const invalidIds = includedRecordIds.filter((id) => !eligibleIds.has(id));
  if (invalidIds.length > 0) {
    throw new ProjectError(`Record ids not eligible for this project: ${invalidIds.join(', ')}`);
  }
  if (includedRecordIds.length === 0) {
    throw new ProjectError('Select at least one meeting to include');
  }

  const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);
  if (!(await canProcessToday(dailyLimit))) {
    throw new ProjectError('Daily LLM limit reached', 429);
  }

  const includedSet = new Set(includedRecordIds);
  const allEligible = [...detail.included, ...detail.excluded, ...detail.pending].sort(
    (a, b) => a.recorded_at - b.recorded_at,
  );
  const includedRecords = allEligible.filter((r) => includedSet.has(r.id));

  const meetings = includedRecords.map((r) => ({
    date: formatMeetingDate(r.recorded_at),
    title: meetingTitle(r),
    summary: r.summary ?? '',
  }));

  try {
    const report = await generateProjectReport(null, meetings);
    const now = Math.floor(Date.now() / 1000);

    db.transaction((tx) => {
      tx.delete(projectRecords).where(eq(projectRecords.project_id, projectId)).run();
      for (const r of allEligible) {
        tx.insert(projectRecords)
          .values({
            project_id: projectId,
            record_id: r.id,
            state: includedSet.has(r.id) ? 'included' : 'excluded',
            updated_at: now,
          })
          .run();
      }
    });

    const period = await recomputePeriod(projectId);

    await db
      .update(projects)
      .set({
        report,
        report_period_start: period.start,
        report_period_end: period.end,
        last_generated_at: now,
        last_error: null,
        updated_at: now,
      })
      .where(eq(projects.id, projectId));

    await incrementToday();

    return getProjectDetail(projectId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ projectId, error: errorMsg }, 'Project report regeneration failed');
    await db
      .update(projects)
      .set({ last_error: errorMsg, updated_at: Math.floor(Date.now() / 1000) })
      .where(eq(projects.id, projectId));
    throw error;
  }
}
