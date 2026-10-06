import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
// 'zod/v3' (not the package root): with the MCP SDK's types the root export trips TS2589 (type instantiation too deep).
import { z } from 'zod/v3';
import { projectDocumentsDir } from '../services/documents';
import { UnsupportedDocumentError, extractDocumentText } from './documentText';
import { compact, fail, findExcerpts, ok, sliceText } from './format';
import {
  McpInputError,
  getDocument,
  getProject,
  getRecordings,
  getTranscript,
  listProjects,
  listTags,
  queryContacts,
  searchRecordings,
} from './queries';
import type { ProjectSection } from './queries';

// Read-only MCP server over AudioVault's data. Design rule: listings are compact and never carry
// bulky bodies; transcripts and documents are fetched in slices or as targeted excerpts, so the
// model pulls in only the text it actually needs.

const INSTRUCTIONS = [
  'AudioVault stores meeting recordings (transcript + LLM summary + tags), projects and contacts. Everything is read-only.',
  'A project = a tag filter (which recordings belong to it) + a running report + notes + documents + contacts.',
  'Be economical: search/list tools return compact rows without bodies. Typical flow:',
  'search_recordings -> get_recordings (summaries) -> read_transcript with `query` only if the summary is not enough.',
  'For projects: list_projects -> get_project asking only for the sections you need -> read_document for attached files.',
  'Dates are "YYYY-MM-DD HH:mm" in the server\'s local time.',
].join(' ');

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;

const DEFAULT_SLICE = 6000;
const MAX_SLICE = 30000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const textWindowShape = {
  offset: z.number().int().min(0).default(0).describe('Character offset to start from (use next_offset from a previous call)'),
  length: z.number().int().min(1).max(MAX_SLICE).default(DEFAULT_SLICE).describe(`Characters to return (default ${DEFAULT_SLICE}, max ${MAX_SLICE})`),
  query: z.string().min(1).optional().describe('Instead of a slice, return up to 8 passages around this phrase (case-insensitive). Cheapest way to locate something.'),
  context_chars: z.number().int().min(0).max(2000).default(250).describe('Characters of context around each match when `query` is used'),
};

interface TextWindow {
  offset: number;
  length: number;
  query?: string;
  context_chars: number;
}

function textWindowResult(meta: Record<string, unknown>, text: string, w: TextWindow): CallToolResult {
  if (w.query) {
    const { match_count, excerpts } = findExcerpts(text, w.query, w.context_chars, 8);
    return ok({ ...meta, total_length: text.length, match_count, excerpts });
  }
  return ok({ ...meta, ...sliceText(text, w.offset, w.length) });
}

// Turns "caller can fix this" errors into tool errors; anything else is a genuine failure.
async function guarded(run: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof McpInputError || error instanceof UnsupportedDocumentError) return fail(error.message);
    throw error;
  }
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'audiovault', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'search_recordings',
    {
      title: 'Search recordings',
      description:
        'Find recordings by full-text (transcripts + summaries), tags, date range or status. Returns compact rows ' +
        '(id, name, date, tags, snippet) — relevance-ordered when `query` is set, newest first otherwise. ' +
        'Bodies are not included: use get_recordings for summaries and read_transcript for transcript text.',
      inputSchema: {
        query: z.string().min(1).optional().describe('Words to find; all must appear. Trailing * = prefix match. Accents are ignored.'),
        tags_all: z.array(z.string()).optional().describe('Recording must have ALL these tags (exact names, see list_tags)'),
        tags_any: z.array(z.string()).optional().describe('Recording must have AT LEAST ONE of these tags'),
        tags_none: z.array(z.string()).optional().describe('Recording must have NONE of these tags'),
        date_from: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        date_to: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        status: z
          .array(z.enum(['pending', 'transcribing', 'transcribed', 'processing', 'done', 'error']))
          .optional()
          .describe('Restrict to these processing statuses ("done" = transcribed and summarized)'),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { title: 'Search recordings', ...READ_ONLY },
    },
    (args) => guarded(() => ok(searchRecordings(args))),
  );

  server.registerTool(
    'get_recordings',
    {
      title: 'Get recordings',
      description:
        'Summary, notes, tags and metadata for up to 10 recordings by id, in one call. Also reports transcript_length ' +
        '(characters); the transcript itself is not included — use read_transcript.',
      inputSchema: { ids: z.array(z.number().int()).min(1).max(10).describe('Recording ids') },
      annotations: { title: 'Get recordings', ...READ_ONLY },
    },
    ({ ids }) => guarded(() => ok(getRecordings(ids))),
  );

  server.registerTool(
    'read_transcript',
    {
      title: 'Read transcript',
      description:
        'Read the transcript of one recording. Transcripts are long: prefer `query` to get only the passages around a ' +
        'phrase, or page through with offset/next_offset.',
      inputSchema: { id: z.number().int().describe('Recording id'), ...textWindowShape },
      annotations: { title: 'Read transcript', ...READ_ONLY },
    },
    ({ id, ...window }) =>
      guarded(() => {
        const t = getTranscript(id);
        if (!t) return fail(`Recording ${id} not found`);
        if (!t.text) return fail(`Recording ${id} has no transcript yet`);
        return textWindowResult({ id, name: t.name }, t.text, window);
      }),
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'All tags with their parent tag and number of recordings. Use the exact names in search_recordings filters.',
      annotations: { title: 'List tags', ...READ_ONLY },
    },
    () => guarded(() => ok(listTags())),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Projects with their tag filter and counts (recordings included/pending/excluded, contacts, documents). ' +
        'No report or notes text — use get_project for that.',
      inputSchema: {
        query: z.string().min(1).optional().describe('Only projects whose title, notes or report contain this text'),
      },
      annotations: { title: 'List projects', ...READ_ONLY },
    },
    ({ query }) => guarded(async () => ok(await listProjects(query))),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'One project. Always returns title, tag filter and counts; request only the `sections` you need: ' +
        'report (running LLM report), notes (the user\'s own notes), recordings (ids/names of included, pending and excluded ' +
        'recordings — fetch their summaries with get_recordings), contacts, documents (metadata; read content with read_document).',
      inputSchema: {
        id: z.number().int().describe('Project id'),
        sections: z
          .array(z.enum(['report', 'notes', 'recordings', 'contacts', 'documents']))
          .default(['report', 'notes'])
          .describe('Which parts to include (default: report and notes)'),
      },
      annotations: { title: 'Get project', ...READ_ONLY },
    },
    ({ id, sections }) =>
      guarded(async () => {
        const project = await getProject(id, sections as ProjectSection[]);
        return project ? ok(project) : fail(`Project ${id} not found`);
      }),
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read project document',
      description:
        'Read a document attached to a project (ids come from get_project sections=["documents"]). PDF, docx, pptx, xlsx and ' +
        'txt are returned as text (pages / slides / sheets are marked); images are returned as images. Legacy .doc/.ppt/.xls ' +
        'cannot be read. Prefer `query` to fetch only relevant passages from long documents.',
      inputSchema: { document_id: z.number().int().describe('Document id'), ...textWindowShape },
      annotations: { title: 'Read project document', ...READ_ONLY },
    },
    ({ document_id, ...window }) =>
      guarded(async () => {
        const doc = await getDocument(document_id);
        if (!doc) return fail(`Document ${document_id} not found`);

        const filePath = path.join(projectDocumentsDir(doc.project_id), doc.stored_name);
        const ext = path.extname(doc.stored_name).toLowerCase();
        const meta = { document_id: doc.id, project_id: doc.project_id, name: doc.original_name };

        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat) return fail('The document file is missing on the server');

        const imageType = IMAGE_TYPES[ext];
        if (imageType) {
          if (stat.size > MAX_IMAGE_BYTES) {
            return fail(`Image is too large to return (${Math.round(stat.size / 1024)} KB, max ${MAX_IMAGE_BYTES / 1024} KB)`);
          }
          const data = (await fs.promises.readFile(filePath)).toString('base64');
          return {
            content: [
              { type: 'text', text: JSON.stringify(compact({ ...meta, type: 'image' })) },
              { type: 'image', data, mimeType: imageType },
            ],
          };
        }

        let text: string;
        try {
          text = await extractDocumentText(`${doc.id}:${stat.size}:${stat.mtimeMs}`, filePath, ext);
        } catch (error) {
          if (error instanceof UnsupportedDocumentError) throw error;
          return fail(`Could not read ${doc.original_name}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        if (!text.trim()) return fail(`${doc.original_name} contains no extractable text (it may be a scan)`);
        return textWindowResult(meta, text, window);
      }),
  );

  server.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description: 'Contacts (name, role, email, phone, notes) with the projects each belongs to. Filter by text or by project.',
      inputSchema: {
        query: z.string().min(1).optional().describe('Matches name, role, email, phone, notes or project title'),
        project_id: z.number().int().optional().describe('Only contacts linked to this project'),
      },
      annotations: { title: 'List contacts', ...READ_ONLY },
    },
    (args) => guarded(() => ok(queryContacts(args))),
  );

  return server;
}
