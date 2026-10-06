import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { and, desc, eq } from 'drizzle-orm';
import db from '../db';
import { projectDocuments, projects } from '../db/schema';
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  allowedExtensionsLabel,
  cleanDocumentName,
  projectDocumentsDir,
} from '../services/documents';

// Documents are private project material: nothing here is read by the LLM/report code paths.

type DocumentRow = typeof projectDocuments.$inferSelect;

// stored_name is an internal detail and is never exposed.
function toDto(d: DocumentRow) {
  return {
    id: d.id,
    project_id: d.project_id,
    name: d.original_name,
    mime_type: d.mime_type,
    size_bytes: d.size_bytes,
    created_at: d.created_at,
  };
}

async function projectExists(id: number): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
  return row !== undefined;
}

// Content-Disposition with an ASCII fallback plus the real UTF-8 name (RFC 5987).
function attachmentHeader(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/projects/:id/documents
  app.get(
    '/api/projects/:id/documents',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      if (Number.isNaN(projectId)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }
      if (!(await projectExists(projectId))) {
        return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
      }

      const rows = await db
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.project_id, projectId))
        .orderBy(desc(projectDocuments.created_at), desc(projectDocuments.id));
      return reply.send(rows.map(toDto));
    },
  );

  // POST /api/projects/:id/documents — multipart upload of a single file (one request per file)
  app.post(
    '/api/projects/:id/documents',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      if (Number.isNaN(projectId)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }
      if (!(await projectExists(projectId))) {
        return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
      }

      const part = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES } });
      if (!part) {
        return reply.status(400).send({ error: 'No file uploaded', statusCode: 400 });
      }

      const name = cleanDocumentName(part.filename);
      const ext = path.extname(name).toLowerCase();
      const mimeType = DOCUMENT_TYPES[ext];
      if (!name || !mimeType) {
        // Discard the rest of the upload so the connection isn't left hanging.
        part.file.on('error', () => undefined);
        part.file.resume();
        return reply.status(415).send({
          error: `Unsupported file type. Allowed: ${allowedExtensionsLabel()}`,
          statusCode: 415,
        });
      }

      const dir = projectDocumentsDir(projectId);
      await fs.promises.mkdir(dir, { recursive: true });
      const storedName = `${randomUUID()}${ext}`;
      const fullPath = path.join(dir, storedName);

      try {
        await pipeline(part.file, fs.createWriteStream(fullPath));
        if (part.file.truncated) {
          throw Object.assign(new Error('too large'), { code: 'FST_REQ_FILE_TOO_LARGE' });
        }

        const { size } = await fs.promises.stat(fullPath);
        const [created] = await db
          .insert(projectDocuments)
          .values({
            project_id: projectId,
            original_name: name,
            stored_name: storedName,
            mime_type: mimeType,
            size_bytes: size,
          })
          .returning();
        return reply.status(201).send(toDto(created));
      } catch (error) {
        // Never leave an orphaned or partial file behind.
        await fs.promises.rm(fullPath, { force: true });
        if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          const mb = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
          return reply.status(413).send({ error: `File is too large (max ${mb} MB)`, statusCode: 413 });
        }
        throw error;
      }
    },
  );

  // GET /api/projects/:id/documents/:docId/download — always served as an attachment
  app.get(
    '/api/projects/:id/documents/:docId/download',
    async (req: FastifyRequest<{ Params: { id: string; docId: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      const docId = parseInt(req.params.docId, 10);
      if (Number.isNaN(projectId) || Number.isNaN(docId)) {
        return reply.status(400).send({ error: 'Invalid id', statusCode: 400 });
      }

      const [doc] = await db
        .select()
        .from(projectDocuments)
        .where(and(eq(projectDocuments.id, docId), eq(projectDocuments.project_id, projectId)));
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found', statusCode: 404 });
      }

      const fullPath = path.join(projectDocumentsDir(projectId), doc.stored_name);
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      if (!stat) {
        return reply.status(404).send({ error: 'Document file is missing on disk', statusCode: 404 });
      }

      return reply
        .header('Content-Type', doc.mime_type)
        .header('Content-Length', stat.size)
        .header('Content-Disposition', attachmentHeader(doc.original_name))
        .header('X-Content-Type-Options', 'nosniff')
        .send(fs.createReadStream(fullPath));
    },
  );

  // DELETE /api/projects/:id/documents/:docId
  app.delete(
    '/api/projects/:id/documents/:docId',
    async (req: FastifyRequest<{ Params: { id: string; docId: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      const docId = parseInt(req.params.docId, 10);
      if (Number.isNaN(projectId) || Number.isNaN(docId)) {
        return reply.status(400).send({ error: 'Invalid id', statusCode: 400 });
      }

      const [doc] = await db
        .select()
        .from(projectDocuments)
        .where(and(eq(projectDocuments.id, docId), eq(projectDocuments.project_id, projectId)));
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found', statusCode: 404 });
      }

      await db.delete(projectDocuments).where(eq(projectDocuments.id, docId));
      await fs.promises.rm(path.join(projectDocumentsDir(projectId), doc.stored_name), { force: true });
      return reply.status(204).send();
    },
  );
}
