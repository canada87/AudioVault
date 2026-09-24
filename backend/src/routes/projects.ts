import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import db from '../db';
import { projects, projectTags } from '../db/schema';
import type { ProjectTagMode, Record as DbRecord } from '../db/schema';
import { getProjectDetail, ProjectError, runIncrementalGenerate, runRegenerateFromSelection } from '../services/projects';
import type { ProjectDetail } from '../services/projects';

interface CreateProjectBody {
  title: string;
  tag_ids: number[];
  tag_mode?: ProjectTagMode;
}

interface UpdateProjectBody {
  title?: string;
  tag_ids?: number[];
  tag_mode?: ProjectTagMode;
  report?: string | null;
}

interface RegenerateBody {
  record_ids: number[];
}

function toRecordDto(r: DbRecord) {
  return {
    id: r.id,
    recorded_at: r.recorded_at,
    display_name: r.display_name,
    original_name: r.original_name,
    summary: r.summary,
  };
}

function isValidTagMode(v: unknown): v is ProjectTagMode {
  return v === 'or' || v === 'and';
}

function toDetailDto(detail: ProjectDetail) {
  return {
    ...detail.project,
    tags: detail.tags,
    included: detail.included.map(toRecordDto),
    excluded: detail.excluded.map(toRecordDto),
    pending: detail.pending.map(toRecordDto),
  };
}

function setProjectTags(projectId: number, tagIds: number[]): void {
  // better-sqlite3's transaction wrapper requires a synchronous callback.
  db.transaction((tx) => {
    tx.delete(projectTags).where(eq(projectTags.project_id, projectId)).run();
    if (tagIds.length > 0) {
      tx.insert(projectTags)
        .values(tagIds.map((tagId) => ({ project_id: projectId, tag_id: tagId })))
        .run();
    }
  });
}

function handleProjectError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof ProjectError) {
    return reply.status(error.status).send({ error: error.message, statusCode: error.status });
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return reply.status(500).send({ error: message, statusCode: 500 });
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/projects
  app.get('/api/projects', async (_req: FastifyRequest, reply: FastifyReply) => {
    const allProjects = await db.select().from(projects).orderBy(projects.updated_at);

    const result = await Promise.all(
      allProjects.map(async (project) => {
        const detail = await getProjectDetail(project.id);

        return {
          id: project.id,
          title: project.title,
          tag_mode: project.tag_mode,
          tags: detail.tags,
          included_count: detail.included.length,
          pending_count: detail.pending.length,
          excluded_count: detail.excluded.length,
          report_period_start: project.report_period_start,
          report_period_end: project.report_period_end,
          last_generated_at: project.last_generated_at,
          last_error: project.last_error,
          has_report: project.report != null,
          created_at: project.created_at,
          updated_at: project.updated_at,
        };
      }),
    );

    return reply.send(result.reverse());
  });

  // POST /api/projects
  app.post('/api/projects', async (req: FastifyRequest<{ Body: CreateProjectBody }>, reply: FastifyReply) => {
    const { title, tag_ids, tag_mode } = req.body;

    if (!title || title.trim().length === 0) {
      return reply.status(400).send({ error: 'Title is required', statusCode: 400 });
    }
    if (!Array.isArray(tag_ids) || tag_ids.length === 0 || !tag_ids.every((id) => typeof id === 'number')) {
      return reply.status(400).send({ error: 'tag_ids must be a non-empty array of numbers', statusCode: 400 });
    }
    if (tag_mode !== undefined && !isValidTagMode(tag_mode)) {
      return reply.status(400).send({ error: "tag_mode must be 'or' or 'and'", statusCode: 400 });
    }

    const [project] = await db
      .insert(projects)
      .values({ title: title.trim(), tag_mode: tag_mode ?? 'or' })
      .returning();

    setProjectTags(project.id, tag_ids);

    return reply.status(201).send(toDetailDto(await getProjectDetail(project.id)));
  });

  // GET /api/projects/:id
  app.get('/api/projects/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
    }

    try {
      return reply.send(toDetailDto(await getProjectDetail(id)));
    } catch (error) {
      return handleProjectError(error, reply);
    }
  });

  // PATCH /api/projects/:id
  app.patch(
    '/api/projects/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateProjectBody }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }

      const [existing] = await db.select().from(projects).where(eq(projects.id, id));
      if (!existing) {
        return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
      }

      const { title, tag_ids, tag_mode, report } = req.body;

      if (title !== undefined && title.trim().length === 0) {
        return reply.status(400).send({ error: 'Title cannot be empty', statusCode: 400 });
      }
      if (tag_ids !== undefined && (!Array.isArray(tag_ids) || !tag_ids.every((tid) => typeof tid === 'number'))) {
        return reply.status(400).send({ error: 'tag_ids must be an array of numbers', statusCode: 400 });
      }
      if (tag_mode !== undefined && !isValidTagMode(tag_mode)) {
        return reply.status(400).send({ error: "tag_mode must be 'or' or 'and'", statusCode: 400 });
      }
      if (report !== undefined && report !== null && typeof report !== 'string') {
        return reply.status(400).send({ error: 'report must be a string or null', statusCode: 400 });
      }

      const updates: { title?: string; tag_mode?: ProjectTagMode; report?: string | null; updated_at: number } = {
        updated_at: Math.floor(Date.now() / 1000),
      };
      if (title !== undefined) updates.title = title.trim();
      if (tag_mode !== undefined) updates.tag_mode = tag_mode;
      if (report !== undefined) updates.report = report;

      await db.update(projects).set(updates).where(eq(projects.id, id));

      if (tag_ids !== undefined) {
        setProjectTags(id, tag_ids);
      }

      return reply.send(toDetailDto(await getProjectDetail(id)));
    },
  );

  // DELETE /api/projects/:id
  app.delete('/api/projects/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
    }

    const [existing] = await db.select().from(projects).where(eq(projects.id, id));
    if (!existing) {
      return reply.status(404).send({ error: 'Project not found', statusCode: 404 });
    }

    await db.delete(projects).where(eq(projects.id, id));
    return reply.status(204).send();
  });

  // POST /api/projects/:id/generate — incremental update using only newly-eligible meetings
  app.post(
    '/api/projects/:id/generate',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }

      try {
        return reply.send(toDetailDto(await runIncrementalGenerate(id, req.log)));
      } catch (error) {
        return handleProjectError(error, reply);
      }
    },
  );

  // POST /api/projects/:id/regenerate — full rebuild from an explicit meeting selection
  app.post(
    '/api/projects/:id/regenerate',
    async (req: FastifyRequest<{ Params: { id: string }; Body: RegenerateBody }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.status(400).send({ error: 'Invalid project id', statusCode: 400 });
      }

      const { record_ids } = req.body;
      if (!Array.isArray(record_ids) || !record_ids.every((rid) => typeof rid === 'number')) {
        return reply.status(400).send({ error: 'record_ids must be an array of numbers', statusCode: 400 });
      }

      try {
        return reply.send(toDetailDto(await runRegenerateFromSelection(id, record_ids, req.log)));
      } catch (error) {
        return handleProjectError(error, reply);
      }
    },
  );
}
