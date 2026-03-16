import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logStore } from '../services/logStore';

const LEVEL_MAP: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

interface LogsQuery {
  level?: string;
  since?: string;
  limit?: string;
}

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/logs?level=warn&since=1709000000000&limit=200
  app.get('/api/logs', async (req: FastifyRequest<{ Querystring: LogsQuery }>, reply: FastifyReply) => {
    const { level, since, limit } = req.query;

    const minLevel = level ? (LEVEL_MAP[level] ?? 0) : 0;
    const sinceTs = since ? parseInt(since, 10) : 0;
    const maxResults = limit ? Math.min(parseInt(limit, 10), 2000) : 500;

    const entries = logStore.query({ minLevel, since: sinceTs, limit: maxResults });

    return reply.send({
      entries,
      total: logStore.size,
    });
  });

  // DELETE /api/logs — clear all logs
  app.delete('/api/logs', async (_req: FastifyRequest, reply: FastifyReply) => {
    logStore.clear();
    return reply.send({ ok: true });
  });
}
