import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import db from '../db';
import { records, settings, dailyLimits } from '../db/schema';
import { getRemainingToday, getLast30DaysUsage } from '../services/limits';

interface SettingsPatchBody {
  [key: string]: string;
}

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/limits/today
  app.get('/api/limits/today', async (_req: FastifyRequest, reply: FastifyReply) => {
    const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);
    const remaining = await getRemainingToday(dailyLimit);
    const used = dailyLimit - remaining;

    return reply.send({ limit: dailyLimit, used, remaining });
  });

  // GET /api/stats
  app.get('/api/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    const [totalCount] = await db.select({ count: sql<number>`count(*)` }).from(records);
    const [pendingCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(records)
      .where(eq(records.status, 'pending'));
    const [doneCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(records)
      .where(eq(records.status, 'done'));
    const [errorCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(records)
      .where(eq(records.status, 'error'));
    const [transcribedCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(records)
      .where(eq(records.status, 'transcribed'));

    const llmUsageLast30 = await getLast30DaysUsage();
    const dailyLimit = parseInt(process.env['LLM_DAILY_LIMIT'] ?? '5', 10);
    const remaining = await getRemainingToday(dailyLimit);

    return reply.send({
      records: {
        total: totalCount?.count ?? 0,
        pending: pendingCount?.count ?? 0,
        transcribed: transcribedCount?.count ?? 0,
        done: doneCount?.count ?? 0,
        error: errorCount?.count ?? 0,
      },
      llm: {
        dailyLimit,
        remaining,
        usageLast30Days: llmUsageLast30,
      },
    });
  });

  // GET /api/settings
  app.get('/api/settings', async (_req: FastifyRequest, reply: FastifyReply) => {
    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) {
      settingsMap[s.key] = s.value;
    }

    // Expose env settings (DB values take priority if present)
    const envDefaults: Record<string, string> = {
      AUDIO_DIR: process.env['AUDIO_DIR'] ?? '',
      LLM_DAILY_LIMIT: process.env['LLM_DAILY_LIMIT'] ?? '5',
      TRANSCRIPTION_CRON: process.env['TRANSCRIPTION_CRON'] ?? '0 4 * * *',
      LLM_POLL_INTERVAL: process.env['LLM_POLL_INTERVAL'] ?? '30',
      GEMINI_MODEL: process.env['GEMINI_MODEL'] ?? 'gemini-1.5-flash',
      STT_POLL_INTERVAL_SECONDS: process.env['STT_POLL_INTERVAL_SECONDS'] ?? '3',
      STT_POLL_TIMEOUT_SECONDS: process.env['STT_POLL_TIMEOUT_SECONDS'] ?? '300',
    };
    for (const [key, fallback] of Object.entries(envDefaults)) {
      if (!settingsMap[key]) {
        settingsMap[key] = fallback;
      }
    }

    return reply.send(settingsMap);
  });

  // PATCH /api/settings
  app.patch(
    '/api/settings',
    async (req: FastifyRequest<{ Body: SettingsPatchBody }>, reply: FastifyReply) => {
      const body = req.body;
      const ALLOWED_KEYS = new Set([
        'LLM_DAILY_LIMIT', 'TRANSCRIPTION_CRON', 'LLM_POLL_INTERVAL', 'LLM_PROMPT',
        'AUDIO_DIR', 'STT_POLL_INTERVAL_SECONDS', 'STT_POLL_TIMEOUT_SECONDS',
      ]);

      for (const [key, value] of Object.entries(body)) {
        if (typeof value !== 'string') continue;
        if (!ALLOWED_KEYS.has(key)) continue;

        // Upsert setting
        const existing = await db
          .select()
          .from(settings)
          .where(eq(settings.key, key));

        if (existing.length > 0) {
          await db.update(settings).set({ value }).where(eq(settings.key, key));
        } else {
          await db.insert(settings).values({ key, value });
        }

        // Update process.env so changes take effect at runtime
        process.env[key] = value;
      }

      const allSettings = await db.select().from(settings);
      const settingsMap: Record<string, string> = {};
      for (const s of allSettings) {
        settingsMap[s.key] = s.value;
      }

      return reply.send(settingsMap);
    },
  );
}

// Suppress unused warning
void dailyLimits;
