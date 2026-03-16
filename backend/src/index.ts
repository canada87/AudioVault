import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

import { registerRecordRoutes } from './routes/records';
import { registerTagRoutes } from './routes/tags';
import { registerAudioRoutes } from './routes/audio';
import { registerStatsRoutes } from './routes/stats';
import { registerLogRoutes } from './routes/logs';
import { logStore } from './services/logStore';
import { startWatcher } from './watcher';
import { startTranscriptionScheduler } from './scheduler/transcription';
import { startSummarizerPoller } from './scheduler/summarizer';
import { Transform } from 'stream';

// Validate environment variables
const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  AUDIO_DIR: z.string().optional(),
  STT_API_URL: z.string().optional(),
  STT_MODEL: z.string().default('istupakov/parakeet-tdt-0.6b-v3-onnx'),
  STT_POLL_INTERVAL_SECONDS: z.string().default('3'),
  STT_POLL_TIMEOUT_SECONDS: z.string().default('300'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  LLM_DAILY_LIMIT: z.string().default('5'),
  LLM_PROMPT_FILE: z.string().optional(),
  TRANSCRIPTION_CRON: z.string().default('0 4 * * *'),
  LLM_POLL_INTERVAL: z.string().default('30'),
  DB_PATH: z.string().default('./data/audiovault.db'),
});

const env = envSchema.parse(process.env);

const isDev = (process.env as Record<string, string | undefined>)['NODE_ENV'] !== 'production';

// Custom Transform stream: captures JSON log entries into the in-memory ring buffer
// and passes them through for console output (pretty-printed in dev, raw JSON in prod).
const logCaptureStream = new Transform({
  transform(chunk: Buffer, _encoding, callback) {
    try {
      const line = chunk.toString().trim();
      if (line) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        logStore.push(parsed);
      }
    } catch {
      // Non-JSON lines — ignore capture, still pass through
    }
    callback(null, chunk);
  },
});

if (isDev) {
  // In dev: pipe JSON through pino-pretty for readable console output
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pinoPretty = require('pino-pretty') as (opts: Record<string, unknown>) => NodeJS.ReadWriteStream;
  const pretty = pinoPretty({ translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' });
  logCaptureStream.pipe(pretty).pipe(process.stdout);
} else {
  logCaptureStream.pipe(process.stdout);
}

const app = Fastify({
  logger: {
    level: 'info',
    stream: logCaptureStream,
  },
});

async function main(): Promise<void> {
  // Register plugins
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB
    },
  });

  // Serve frontend static files in production
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    await app.register(staticFiles, {
      root: frontendDist,
      prefix: '/',
    });
    app.log.info({ frontendDist }, 'Serving frontend static files');
  }

  // Register routes
  await registerRecordRoutes(app);
  await registerTagRoutes(app);
  await registerAudioRoutes(app);
  await registerStatsRoutes(app);
  await registerLogRoutes(app);

  // Health check
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // SPA fallback (serves index.html for all non-API routes)
  if (fs.existsSync(frontendDist)) {
    app.setNotFoundHandler(async (req, reply) => {
      if (!req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found', statusCode: 404 });
    });
  }

  // Start server
  const port = parseInt(env.PORT, 10);
  const host = env.HOST;

  await app.listen({ port, host });
  app.log.info(`AudioVault backend running on http://${host}:${port}`);

  // Start file watcher
  startWatcher(app.log);

  // Start schedulers
  startTranscriptionScheduler(app.log);
  startSummarizerPoller(app.log);
}

main().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
