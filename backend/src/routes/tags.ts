import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, sql, ne, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import db from '../db';
import { tags, recordTags } from '../db/schema';

interface CreateTagBody {
  name: string;
  parent_id?: number | null;
}

interface UpdateTagBody {
  name?: string;
  parent_id?: number | null;
}

// Max depth = 2 levels: a root tag and one level of children. A tag with a
// parent cannot itself be made a parent, and a tag with children cannot be
// reparented under anything.
async function validateParent(
  tagId: number | null,
  parentId: number | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (parentId === null || parentId === undefined) {
    return { ok: true };
  }

  if (tagId !== null && parentId === tagId) {
    return { ok: false, error: 'A tag cannot be its own parent', status: 400 };
  }

  const [parent] = await db.select().from(tags).where(eq(tags.id, parentId));
  if (!parent) {
    return { ok: false, error: 'Parent tag not found', status: 400 };
  }

  // Parent must itself be a root (enforces 2-level max)
  if (parent.parent_id !== null) {
    return { ok: false, error: 'Parent tag must be a root tag (max hierarchy depth is 2)', status: 400 };
  }

  // If this tag already has children, it cannot become a child
  if (tagId !== null) {
    const children = await db.select({ id: tags.id }).from(tags).where(eq(tags.parent_id, tagId));
    if (children.length > 0) {
      return {
        ok: false,
        error: 'This tag has children and cannot be moved under another tag (max depth is 2)',
        status: 400,
      };
    }
  }

  return { ok: true };
}

export async function registerTagRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/tags — includes record_count, parent_id, parent_name
  app.get('/api/tags', async (_req: FastifyRequest, reply: FastifyReply) => {
    const parents = alias(tags, 'parents');
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        parent_id: tags.parent_id,
        parent_name: parents.name,
        record_count: sql<number>`COUNT(${recordTags.tag_id})`.as('record_count'),
      })
      .from(tags)
      .leftJoin(recordTags, eq(recordTags.tag_id, tags.id))
      .leftJoin(parents, eq(parents.id, tags.parent_id))
      .groupBy(tags.id)
      .orderBy(tags.name);
    return reply.send(rows);
  });

  // POST /api/tags
  app.post('/api/tags', async (req: FastifyRequest<{ Body: CreateTagBody }>, reply: FastifyReply) => {
    const { name, parent_id } = req.body;

    if (!name || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Tag name is required', statusCode: 400 });
    }

    if (parent_id !== undefined && parent_id !== null && (typeof parent_id !== 'number' || !Number.isInteger(parent_id))) {
      return reply.status(400).send({ error: 'parent_id must be an integer or null', statusCode: 400 });
    }

    const trimmedName = name.trim().toLowerCase();

    // Check if tag already exists
    const [existing] = await db.select().from(tags).where(eq(tags.name, trimmedName));
    if (existing) {
      return reply.status(409).send({ error: 'Tag already exists', statusCode: 409, tag: existing });
    }

    const normalizedParent = parent_id ?? null;
    const validation = await validateParent(null, normalizedParent);
    if (!validation.ok) {
      return reply.status(validation.status).send({ error: validation.error, statusCode: validation.status });
    }

    const [newTag] = await db
      .insert(tags)
      .values({ name: trimmedName, parent_id: normalizedParent })
      .returning();

    let parentName: string | null = null;
    if (newTag.parent_id !== null) {
      const [parent] = await db.select({ name: tags.name }).from(tags).where(eq(tags.id, newTag.parent_id));
      parentName = parent?.name ?? null;
    }

    return reply.status(201).send({ ...newTag, parent_name: parentName, record_count: 0 });
  });

  // PATCH /api/tags/:id — rename and/or re-parent
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

      const { name, parent_id } = req.body;
      const nameProvided = name !== undefined;
      const parentProvided = Object.prototype.hasOwnProperty.call(req.body, 'parent_id');

      if (!nameProvided && !parentProvided) {
        return reply.status(400).send({ error: 'Nothing to update', statusCode: 400 });
      }

      if (nameProvided && (!name || name.trim().length === 0)) {
        return reply.status(400).send({ error: 'Tag name cannot be empty', statusCode: 400 });
      }

      if (parentProvided && parent_id !== null && (typeof parent_id !== 'number' || !Number.isInteger(parent_id))) {
        return reply.status(400).send({ error: 'parent_id must be an integer or null', statusCode: 400 });
      }

      const [existing] = await db.select().from(tags).where(eq(tags.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Tag not found', statusCode: 404 });
      }

      const updates: { name?: string; parent_id?: number | null } = {};

      if (nameProvided) {
        const trimmedName = name!.trim().toLowerCase();
        if (trimmedName !== existing.name) {
          const [conflict] = await db
            .select()
            .from(tags)
            .where(and(eq(tags.name, trimmedName), ne(tags.id, id)));
          if (conflict) {
            return reply
              .status(409)
              .send({ error: 'Another tag with this name already exists', statusCode: 409 });
          }
          updates.name = trimmedName;
        }
      }

      if (parentProvided) {
        const normalizedParent = parent_id ?? null;
        if (normalizedParent !== existing.parent_id) {
          const validation = await validateParent(id, normalizedParent);
          if (!validation.ok) {
            return reply.status(validation.status).send({ error: validation.error, statusCode: validation.status });
          }
          updates.parent_id = normalizedParent;
        }
      }

      if (Object.keys(updates).length === 0) {
        // Nothing to change — return current state with parent_name
        let parentName: string | null = null;
        if (existing.parent_id !== null) {
          const [p] = await db.select({ name: tags.name }).from(tags).where(eq(tags.id, existing.parent_id));
          parentName = p?.name ?? null;
        }
        return reply.send({ ...existing, parent_name: parentName });
      }

      const [updated] = await db.update(tags).set(updates).where(eq(tags.id, id)).returning();

      let parentName: string | null = null;
      if (updated.parent_id !== null) {
        const [p] = await db.select({ name: tags.name }).from(tags).where(eq(tags.id, updated.parent_id));
        parentName = p?.name ?? null;
      }

      return reply.send({ ...updated, parent_name: parentName });
    },
  );

  // DELETE /api/tags/:id — children are orphaned (parent_id → NULL) via FK
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
