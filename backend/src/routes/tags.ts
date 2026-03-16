import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import db from '../db';
import { tags } from '../db/schema';

interface CreateTagBody {
  name: string;
}

export async function registerTagRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/tags
  app.get('/api/tags', async (_req: FastifyRequest, reply: FastifyReply) => {
    const allTags = await db.select().from(tags).orderBy(tags.name);
    return reply.send(allTags);
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
    return reply.status(201).send(newTag);
  });

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
