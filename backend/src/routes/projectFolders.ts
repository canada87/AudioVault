import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import db from '../db';
import { projectFolders, projects } from '../db/schema';

// Folders only organise the projects list: they have no effect on reports or recordings.

interface FolderBody {
  name?: unknown;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= 100 ? name : null;
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const rows = await db
    .select({ id: projectFolders.id })
    .from(projectFolders)
    .where(sql`lower(${projectFolders.name}) = lower(${name})`);
  return rows.some((r) => r.id !== exceptId);
}

export async function registerProjectFolderRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/project-folders
  app.get('/api/project-folders', async (_req: FastifyRequest, reply: FastifyReply) => {
    const folders = await db.select().from(projectFolders).orderBy(asc(sql`lower(${projectFolders.name})`));
    const counts = await db
      .select({ folder_id: projects.folder_id, n: sql<number>`count(*)` })
      .from(projects)
      .groupBy(projects.folder_id);
    const countByFolder = new Map(counts.map((c) => [c.folder_id, c.n]));
    return reply.send(
      folders.map((f) => ({
        id: f.id,
        name: f.name,
        project_count: countByFolder.get(f.id) ?? 0,
        created_at: f.created_at,
      })),
    );
  });

  // POST /api/project-folders
  app.post('/api/project-folders', async (req: FastifyRequest<{ Body: FolderBody }>, reply: FastifyReply) => {
    const name = cleanName(req.body?.name);
    if (!name) {
      return reply.status(400).send({ error: 'Folder name is required (max 100 characters)', statusCode: 400 });
    }
    if (await nameTaken(name)) {
      return reply.status(409).send({ error: 'A folder with this name already exists', statusCode: 409 });
    }
    const [created] = await db.insert(projectFolders).values({ name }).returning();
    return reply.status(201).send({ id: created.id, name: created.name, project_count: 0, created_at: created.created_at });
  });

  // PATCH /api/project-folders/:id — rename
  app.patch(
    '/api/project-folders/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: FolderBody }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid folder id', statusCode: 400 });
      }
      const name = cleanName(req.body?.name);
      if (!name) {
        return reply.status(400).send({ error: 'Folder name is required (max 100 characters)', statusCode: 400 });
      }
      const [existing] = await db.select().from(projectFolders).where(eq(projectFolders.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Folder not found', statusCode: 404 });
      }
      if (await nameTaken(name, id)) {
        return reply.status(409).send({ error: 'A folder with this name already exists', statusCode: 409 });
      }
      await db.update(projectFolders).set({ name }).where(eq(projectFolders.id, id));
      return reply.send({ id, name });
    },
  );

  // DELETE /api/project-folders/:id — its projects are kept and become uncategorised (FK ON DELETE SET NULL)
  app.delete(
    '/api/project-folders/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid folder id', statusCode: 400 });
      }
      const [existing] = await db.select().from(projectFolders).where(eq(projectFolders.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Folder not found', statusCode: 404 });
      }
      await db.delete(projectFolders).where(eq(projectFolders.id, id));
      return reply.status(204).send();
    },
  );
}
