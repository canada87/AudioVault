import { eq } from 'drizzle-orm';
import db, { sqlite } from '../db';
import { contacts, projectDocuments, projects } from '../db/schema';
import { getProjectDetail } from '../services/projects';
import { evaluateTagQuery } from '../services/tagQuery';
import type { TagQueryNode } from '../services/tagQuery';
import { formatDateTime } from './format';

// Read-only data access for the MCP tools. Each function returns only the fields a tool exposes;
// bulky columns (transcription, report, ...) are fetched by dedicated calls, never in listings.

// A problem with the caller's input that the model can fix by itself (unknown tag, bad date...).
export class McpInputError extends Error {}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(day: string, endOfDay: boolean): number {
  if (!DAY_PATTERN.test(day)) throw new McpInputError(`Invalid date "${day}", expected YYYY-MM-DD`);
  // Local time on purpose: recorded_at stores the file-name time interpreted in server-local time.
  const ms = new Date(`${day}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime();
  if (Number.isNaN(ms)) throw new McpInputError(`Invalid date "${day}"`);
  return Math.floor(ms / 1000);
}

// ---------------------------------------------------------------- recordings

export interface SearchParams {
  query?: string;
  tags_all?: string[];
  tags_any?: string[];
  tags_none?: string[];
  date_from?: string;
  date_to?: string;
  status?: string[];
  limit: number;
  offset: number;
}

// Free text -> safe FTS5 expression: every word must appear (AND); a trailing * makes it a prefix.
// Quoting each word means punctuation in natural language can't produce an FTS syntax error.
function toFtsExpression(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((t) => ({ prefix: t.endsWith('*'), core: t.replace(/[*"]/g, '') }))
    .filter((t) => t.core.length > 0);
  if (terms.length === 0) throw new McpInputError('query is empty');
  return terms.map((t) => `"${t.core}"${t.prefix ? '*' : ''}`).join(' ');
}

function resolveTagIds(names: string[], byName: Map<string, number>, unknown: string[]): number[] {
  const ids: number[] = [];
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id === undefined) unknown.push(name);
    else ids.push(id);
  }
  return ids;
}

function loadRecordTagSets(): Map<number, Set<number>> {
  const byRecord = new Map<number, Set<number>>();
  for (const row of sqlite.prepare('SELECT record_id, tag_id FROM record_tags').all() as Array<{
    record_id: number;
    tag_id: number;
  }>) {
    const set = byRecord.get(row.record_id) ?? new Set<number>();
    set.add(row.tag_id);
    byRecord.set(row.record_id, set);
  }
  return byRecord;
}

interface RecordRow {
  id: number;
  original_name: string;
  display_name: string | null;
  recorded_at: number;
  duration_seconds: number | null;
  status: string;
  has_summary: number;
}

function tagNamesByRecord(recordIds: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (recordIds.length === 0) return out;
  const marks = recordIds.map(() => '?').join(',');
  const rows = sqlite
    .prepare(
      `SELECT rt.record_id, t.name FROM record_tags rt JOIN tags t ON t.id = rt.tag_id
       WHERE rt.record_id IN (${marks}) ORDER BY t.name`,
    )
    .all(...recordIds) as Array<{ record_id: number; name: string }>;
  for (const r of rows) out.set(r.record_id, [...(out.get(r.record_id) ?? []), r.name]);
  return out;
}

export function searchRecordings(p: SearchParams) {
  // 1. Full-text candidates (ranked), or every record when there is no text query.
  let ranked: Map<number, string> | null = null;
  if (p.query) {
    const rows = sqlite
      .prepare(
        `SELECT rowid AS id, snippet(records_fts, -1, '«', '»', '…', 20) AS snippet
         FROM records_fts WHERE records_fts MATCH ? ORDER BY rank LIMIT 1000`,
      )
      .all(toFtsExpression(p.query)) as Array<{ id: number; snippet: string }>;
    ranked = new Map(rows.map((r) => [r.id, r.snippet]));
  }

  // 2. Structured filters in SQL.
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (ranked) {
    if (ranked.size === 0) return { total: 0, returned: 0, offset: p.offset, next_offset: null, results: [] };
    where.push(`id IN (${[...ranked.keys()].map(() => '?').join(',')})`);
    args.push(...ranked.keys());
  }
  if (p.date_from) {
    where.push('recorded_at >= ?');
    args.push(dayStart(p.date_from, false));
  }
  if (p.date_to) {
    where.push('recorded_at <= ?');
    args.push(dayStart(p.date_to, true));
  }
  if (p.status && p.status.length > 0) {
    where.push(`status IN (${p.status.map(() => '?').join(',')})`);
    args.push(...p.status);
  }

  let rows = sqlite
    .prepare(
      `SELECT id, original_name, display_name, recorded_at, duration_seconds, status,
              (summary IS NOT NULL AND trim(summary) != '') AS has_summary
       FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    )
    .all(...args) as RecordRow[];

  // 3. Tag filters, evaluated with the same boolean engine that powers project queries.
  const wantsTags = [p.tags_all, p.tags_any, p.tags_none].some((l) => l && l.length > 0);
  if (wantsTags) {
    const byName = new Map(
      (sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>).map((t) => [
        t.name.toLowerCase(),
        t.id,
      ]),
    );
    const unknown: string[] = [];
    const all = resolveTagIds(p.tags_all ?? [], byName, unknown);
    const any = resolveTagIds(p.tags_any ?? [], byName, unknown);
    const none = resolveTagIds(p.tags_none ?? [], byName, unknown);
    if (unknown.length > 0) {
      throw new McpInputError(`Unknown tag(s): ${unknown.join(', ')}. Use list_tags to see the exact names.`);
    }

    const children: TagQueryNode[] = [
      ...all.map((tag_id): TagQueryNode => ({ type: 'tag', tag_id, not: false })),
      ...none.map((tag_id): TagQueryNode => ({ type: 'tag', tag_id, not: true })),
    ];
    if (any.length > 0) {
      children.push({
        type: 'group',
        op: 'or',
        not: false,
        children: any.map((tag_id): TagQueryNode => ({ type: 'tag', tag_id, not: false })),
      });
    }
    const query: TagQueryNode = { type: 'group', op: 'and', not: false, children };
    const sets = loadRecordTagSets();
    const noTags = new Set<number>();
    rows = rows.filter((r) => evaluateTagQuery(query, sets.get(r.id) ?? noTags));
  }

  // 4. Order (relevance for text searches, newest first otherwise) and paginate.
  if (ranked) {
    const order = [...ranked.keys()];
    rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  } else {
    rows.sort((a, b) => b.recorded_at - a.recorded_at);
  }
  const page = rows.slice(p.offset, p.offset + p.limit);
  const tagNames = tagNamesByRecord(page.map((r) => r.id));

  return {
    total: rows.length,
    returned: page.length,
    offset: p.offset,
    next_offset: p.offset + page.length < rows.length ? p.offset + page.length : null,
    results: page.map((r) => ({
      id: r.id,
      name: r.display_name ?? r.original_name,
      date: formatDateTime(r.recorded_at),
      duration_seconds: r.duration_seconds,
      status: r.status,
      has_summary: Boolean(r.has_summary),
      tags: tagNames.get(r.id) ?? [],
      snippet: ranked?.get(r.id),
    })),
  };
}

export function getRecordings(ids: number[]) {
  const marks = ids.map(() => '?').join(',');
  const rows = sqlite
    .prepare(
      `SELECT id, original_name, display_name, recorded_at, duration_seconds, status, summary, notes,
              length(transcription) AS transcript_length
       FROM records WHERE id IN (${marks})`,
    )
    .all(...ids) as Array<RecordRow & { summary: string | null; notes: string | null; transcript_length: number | null }>;
  const found = new Map(rows.map((r) => [r.id, r]));
  const tagNames = tagNamesByRecord(rows.map((r) => r.id));

  return {
    recordings: ids
      .filter((id) => found.has(id))
      .map((id) => {
        const r = found.get(id)!;
        return {
          id: r.id,
          name: r.display_name ?? r.original_name,
          date: formatDateTime(r.recorded_at),
          duration_seconds: r.duration_seconds,
          status: r.status,
          tags: tagNames.get(r.id) ?? [],
          summary: r.summary,
          notes: r.notes,
          transcript_length: r.transcript_length ?? 0,
        };
      }),
    not_found: ids.filter((id) => !found.has(id)),
  };
}

export function getTranscript(id: number): { name: string; text: string } | null {
  const row = sqlite
    .prepare('SELECT original_name, display_name, transcription FROM records WHERE id = ?')
    .get(id) as { original_name: string; display_name: string | null; transcription: string | null } | undefined;
  if (!row) return null;
  return { name: row.display_name ?? row.original_name, text: row.transcription ?? '' };
}

export function listTags() {
  const rows = sqlite
    .prepare(
      `SELECT t.name, p.name AS parent, COUNT(rt.record_id) AS recordings
       FROM tags t LEFT JOIN tags p ON p.id = t.parent_id LEFT JOIN record_tags rt ON rt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name`,
    )
    .all() as Array<{ name: string; parent: string | null; recordings: number }>;
  return { tags: rows };
}

// ------------------------------------------------------------------ projects

function projectCounts(table: 'project_contacts' | 'project_documents'): Map<number, number> {
  const rows = sqlite.prepare(`SELECT project_id, COUNT(*) AS n FROM ${table} GROUP BY project_id`).all() as Array<{
    project_id: number;
    n: number;
  }>;
  return new Map(rows.map((r) => [r.project_id, r.n]));
}

export async function listProjects(query?: string) {
  const needle = query?.trim().toLowerCase();
  const rows = (await db.select().from(projects)).filter(
    (p) => !needle || [p.title, p.notes, p.report].some((f) => f?.toLowerCase().includes(needle)),
  );
  const contactCounts = projectCounts('project_contacts');
  const documentCounts = projectCounts('project_documents');

  const out = [];
  for (const p of rows.sort((a, b) => b.updated_at - a.updated_at)) {
    const d = await getProjectDetail(p.id);
    out.push({
      id: p.id,
      title: p.title,
      tag_filter: d.queryText,
      recordings: { included: d.included.length, pending: d.pending.length, excluded: d.excluded.length },
      has_report: p.report != null && p.report !== '',
      report_updated: p.last_generated_at ? formatDateTime(p.last_generated_at) : null,
      contacts: contactCounts.get(p.id) ?? 0,
      documents: documentCounts.get(p.id) ?? 0,
    });
  }
  return { projects: out };
}

export type ProjectSection = 'report' | 'notes' | 'recordings' | 'contacts' | 'documents';

export async function getProject(id: number, sections: ProjectSection[]) {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
  if (!row) return null;

  const d = await getProjectDetail(id);
  const p = d.project;
  const want = new Set(sections);
  const brief = (r: { id: number; display_name: string | null; original_name: string; recorded_at: number }) => ({
    id: r.id,
    name: r.display_name ?? r.original_name,
    date: formatDateTime(r.recorded_at),
  });

  return {
    id: p.id,
    title: p.title,
    tag_filter: d.queryText,
    report_period:
      p.report_period_start && p.report_period_end
        ? `${formatDateTime(p.report_period_start).slice(0, 10)} → ${formatDateTime(p.report_period_end).slice(0, 10)}`
        : null,
    report_updated: p.last_generated_at ? formatDateTime(p.last_generated_at) : null,
    recording_counts: { included: d.included.length, pending: d.pending.length, excluded: d.excluded.length },
    report: want.has('report') ? p.report : undefined,
    notes: want.has('notes') ? p.notes : undefined,
    recordings: want.has('recordings')
      ? { included: d.included.map(brief), pending: d.pending.map(brief), excluded: d.excluded.map(brief) }
      : undefined,
    contacts: want.has('contacts') ? queryContacts({ project_id: id }).contacts : undefined,
    documents: want.has('documents') ? listProjectDocuments(id) : undefined,
  };
}

function listProjectDocuments(projectId: number) {
  const rows = sqlite
    .prepare(
      'SELECT id, original_name, size_bytes, created_at FROM project_documents WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    )
    .all(projectId) as Array<{ id: number; original_name: string; size_bytes: number; created_at: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.original_name,
    size_kb: Math.max(1, Math.round(r.size_bytes / 1024)),
    uploaded: formatDateTime(r.created_at).slice(0, 10),
  }));
}

export async function getDocument(documentId: number) {
  const [doc] = await db.select().from(projectDocuments).where(eq(projectDocuments.id, documentId));
  return doc ?? null;
}

// ------------------------------------------------------------------ contacts

export function queryContacts(p: { query?: string; project_id?: number }) {
  const rows = sqlite.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all() as Array<
    typeof contacts.$inferSelect
  >;
  const links = sqlite
    .prepare(
      'SELECT pc.contact_id, p.id, p.title FROM project_contacts pc JOIN projects p ON p.id = pc.project_id ORDER BY p.title',
    )
    .all() as Array<{ contact_id: number; id: number; title: string }>;

  const projectsByContact = new Map<number, Array<{ id: number; title: string }>>();
  for (const l of links) {
    projectsByContact.set(l.contact_id, [...(projectsByContact.get(l.contact_id) ?? []), { id: l.id, title: l.title }]);
  }

  const needle = p.query?.trim().toLowerCase();
  const result = rows
    .map((c) => ({ c, projects: projectsByContact.get(c.id) ?? [] }))
    .filter(({ projects: ps }) => p.project_id === undefined || ps.some((x) => x.id === p.project_id))
    .filter(
      ({ c, projects: ps }) =>
        !needle ||
        [c.name, c.role, c.email, c.phone, c.notes, ...ps.map((x) => x.title)].some((f) => f?.toLowerCase().includes(needle)),
    )
    .map(({ c, projects: ps }) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      notes: c.notes,
      projects: ps,
    }));
  return { contacts: result };
}
