import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import db from '../db';
import { contacts, projectContacts, projects } from '../db/schema';

// Contacts are personal data: they are deliberately never read by the LLM/report code paths.

const TEXT_FIELDS = ['role', 'email', 'phone', 'notes'] as const;

interface ContactFields {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

type ContactBody = Partial<Record<keyof ContactFields, unknown>>;

type ParseResult = { ok: true; fields: Partial<ContactFields> } | { ok: false; error: string };

// Trims strings; blank/null optional fields become null. `name` is mandatory when creating.
function parseContactFields(body: ContactBody | undefined, creating: boolean): ParseResult {
  const fields: Partial<ContactFields> = {};
  const input = body ?? {};

  if (input.name !== undefined || creating) {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      return { ok: false, error: 'Name is required' };
    }
    fields.name = input.name.trim();
  }

  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: `${key} must be a string or null` };
    }
    const trimmed = typeof value === 'string' ? value.trim() : '';
    fields[key] = trimmed.length > 0 ? trimmed : null;
  }

  return { ok: true, fields };
}

type ContactRow = typeof contacts.$inferSelect;

interface ContactDto extends ContactRow {
  projects: Array<{ id: number; title: string }>;
}

// Loads contacts together with every project they are linked to.
async function loadContacts(onlyIds?: number[]): Promise<ContactDto[]> {
  if (onlyIds && onlyIds.length === 0) return [];

  const rows = onlyIds
    ? await db.select().from(contacts).where(inArray(contacts.id, onlyIds))
    : await db.select().from(contacts);

  const links = await db
    .select({ contact_id: projectContacts.contact_id, id: projects.id, title: projects.title })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.project_id));

  const projectsByContact = new Map<number, Array<{ id: number; title: string }>>();
  for (const link of links) {
    const list = projectsByContact.get(link.contact_id) ?? [];
    list.push({ id: link.id, title: link.title });
    projectsByContact.set(link.contact_id, list);
  }

  return rows
    .map((c) => ({
      ...c,
      projects: (projectsByContact.get(c.id) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function projectExists(id: number): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
  return row !== undefined;
}

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/contacts — every contact with the projects it belongs to
  app.get('/api/contacts', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await loadContacts());
  });

  // POST /api/contacts
  app.post('/api/contacts', async (req: FastifyRequest<{ Body: ContactBody }>, reply: FastifyReply) => {
    const parsed = parseContactFields(req.body, true);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error, statusCode: 400 });
    }

    const [created] = await db
      .insert(contacts)
      .values(parsed.fields as ContactFields)
      .returning();
    const [dto] = await loadContacts([created.id]);
    return reply.status(201).send(dto);
  });

  // PATCH /api/contacts/:id — edits the person everywhere they appear
  app.patch(
    '/api/contacts/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: ContactBody }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid contact id', statusCode: 400 });
      }

      const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Contact not found', statusCode: 404 });
      }

      const parsed = parseContactFields(req.body, false);
      if (!parsed.ok) {
        return reply.status(400).send({ error: parsed.error, statusCode: 400 });
      }

      await db
        .update(contacts)
        .set({ ...parsed.fields, updated_at: Math.floor(Date.now() / 1000) })
        .where(eq(contacts.id, id));

      const [dto] = await loadContacts([id]);
      return reply.send(dto);
    },
  );

  // DELETE /api/contacts/:id — removes the person and all their project links
  app.delete('/api/contacts/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid contact id', statusCode: 400 });
    }

    const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
    if (!existing) {
      return reply.status(404).send({ error: 'Contact not found', statusCode: 404 });
    }

    await db.delete(contacts).where(eq(contacts.id, id));
    return reply.status(204).send();
  });

  // GET /api/projects/:id/contacts
  app.get(
    '/api/projects/:id/contacts',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      if (Number.isNaN(projectId)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }
      if (!(await projectExists(projectId))) {
        return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
      }

      const links = await db
        .select({ contact_id: projectContacts.contact_id })
        .from(projectContacts)
        .where(eq(projectContacts.project_id, projectId));
      return reply.send(await loadContacts(links.map((l) => l.contact_id)));
    },
  );

  // POST /api/projects/:id/contacts — body is { contact_id } to link an existing contact,
  // or { contact: {...fields} } to create a new one and link it in a single step.
  app.post(
    '/api/projects/:id/contacts',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { contact_id?: unknown; contact?: ContactBody } }>,
      reply: FastifyReply,
    ) => {
      const projectId = parseInt(req.params.id, 10);
      if (Number.isNaN(projectId)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }
      if (!(await projectExists(projectId))) {
        return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
      }

      const { contact_id, contact } = req.body ?? {};
      let contactId: number;

      if (contact_id !== undefined) {
        if (typeof contact_id !== 'number' || !Number.isInteger(contact_id)) {
          return reply.status(400).send({ error: 'contact_id must be an integer', statusCode: 400 });
        }
        const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contact_id));
        if (!existing) {
          return reply.status(404).send({ error: 'Contact not found', statusCode: 404 });
        }
        contactId = contact_id;
        await db.insert(projectContacts).values({ project_id: projectId, contact_id: contactId }).onConflictDoNothing();
      } else if (contact !== undefined) {
        const parsed = parseContactFields(contact, true);
        if (!parsed.ok) {
          return reply.status(400).send({ error: parsed.error, statusCode: 400 });
        }
        // better-sqlite3's transaction wrapper requires a synchronous callback.
        contactId = db.transaction((tx) => {
          const created = tx
            .insert(contacts)
            .values(parsed.fields as ContactFields)
            .returning({ id: contacts.id })
            .get();
          tx.insert(projectContacts).values({ project_id: projectId, contact_id: created.id }).run();
          return created.id;
        });
      } else {
        return reply.status(400).send({ error: 'Provide contact_id or contact', statusCode: 400 });
      }

      const [dto] = await loadContacts([contactId]);
      return reply.status(201).send(dto);
    },
  );

  // DELETE /api/projects/:id/contacts/:contactId — unlinks only; the contact itself is kept
  app.delete(
    '/api/projects/:id/contacts/:contactId',
    async (req: FastifyRequest<{ Params: { id: string; contactId: string } }>, reply: FastifyReply) => {
      const projectId = parseInt(req.params.id, 10);
      const contactId = parseInt(req.params.contactId, 10);
      if (Number.isNaN(projectId) || Number.isNaN(contactId)) {
        return reply.status(400).send({ error: 'Invalid id', statusCode: 400 });
      }

      await db
        .delete(projectContacts)
        .where(and(eq(projectContacts.project_id, projectId), eq(projectContacts.contact_id, contactId)));
      return reply.status(204).send();
    },
  );
}
