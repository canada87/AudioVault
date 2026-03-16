import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import db from '../db';
import { records } from '../db/schema';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/audio/:id — streams audio with Range support (206)
  app.get('/api/audio/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = parseInt(req.params.id, 10);

    const [record] = await db.select().from(records).where(eq(records.id, id));
    if (!record) {
      return reply.status(404).send({ error: 'Record not found', statusCode: 404 });
    }

    if (record.audio_deleted) {
      return reply.status(410).send({ error: 'Audio file has been deleted', statusCode: 410 });
    }

    if (!fs.existsSync(record.file_path)) {
      return reply.status(404).send({ error: 'Audio file not found on disk', statusCode: 404 });
    }

    const stat = fs.statSync(record.file_path);
    const fileSize = stat.size;
    const rangeHeader = (req.headers as Record<string, string | undefined>)['range'];

    if (rangeHeader) {
      // Parse Range header: bytes=start-end
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] ?? '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return reply
          .status(416)
          .header('Content-Range', `bytes */${fileSize}`)
          .send({ error: 'Range Not Satisfiable', statusCode: 416 });
      }

      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(record.file_path, { start, end });

      return reply
        .status(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', chunkSize.toString())
        .header('Content-Type', MIME_TYPES[path.extname(record.file_path).toLowerCase()] ?? 'application/octet-stream')
        .send(stream);
    } else {
      // Send entire file
      const stream = fs.createReadStream(record.file_path);
      return reply
        .status(200)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', fileSize.toString())
        .header('Content-Type', MIME_TYPES[path.extname(record.file_path).toLowerCase()] ?? 'application/octet-stream')
        .send(stream);
    }
  });
}
