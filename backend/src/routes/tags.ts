import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, sql, ne, and } from 'drizzle-orm';
import db from '../db';
import { tags, recordTags } from '../db/schema';

interface CreateTagBody {
  name: string;
}

interface UpdateTagBody {
  name: string;
}

export async function registerTagRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/tags — includes record_count for each tag
  app.get('/api/tags', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        record_count: sql<number>`COUNT(${recordTags.tag_id})`.as('record_count'),
      })
      .from(tags)
      .leftJoin(recordTags, eq(recordTags.tag_id, tags.id))
      .groupBy(tags.id)
      .orderBy(tags.name);
    return reply.send(rows);
  });

  // POST /api/tags
  app.post('/api/tags', async (req: FastifyRequest<{ Body: CreateTagBody }>, reply: FastifyReply) => {
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Tag name is required', statusCode: 400 });
    }

    const trimmedName = name.trim().toLowerCase();

    // Check if tag already exists
    const [existing] = await db.select().from(tags).where(eq(tags.name, trimmedName));
    if (existing) {
      return reply.status(409).send({ error: 'Tag already exists', statusCode: 409, tag: existing });
    }

    const [newTag] = await db.insert(tags).values({ name: trimmedName }).returning();
    return reply.status(201).send({ ...newTag, record_count: 0 });
  });

  // PATCH /api/tags/:id — rename
  app.patch(
    '/api/tags/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: UpdateTagBody }>,
      reply: FastifyReply,
    ) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid tag id', statusCode: 400 });
      }

      const { name } = req.body;
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Tag name is required', statusCode: 400 });
      }

      const trimmedName = name.trim().toLowerCase();

      const [existing] = await db.select().from(tags).where(eq(tags.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Tag not found', statusCode: 404 });
      }

      if (existing.name === trimmedName) {
        return reply.send(existing);
      }

      const [conflict] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.name, trimmedName), ne(tags.id, id)));
      if (conflict) {
        return reply.status(409).send({ error: 'Another tag with this name already exists', statusCode: 409 });
      }

      const [updated] = await db
        .update(tags)
        .set({ name: trimmedName })
        .where(eq(tags.id, id))
        .returning();
      return reply.send(updated);
    },
  );

  // DELETE /api/tags/:id
  app.delete('/api/tags/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);

    const [existing] = await db.select().from(tags).where(eq(tags.id, id));
    if (!existing) {
      return reply.status(404).send({ error: 'Tag not found', statusCode: 404 });
    }

    await db.delete(tags).where(eq(tags.id, id));
    return reply.status(204).send();
  });
}
