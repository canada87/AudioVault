import { spawn } from 'child_process';
import https from 'https';

export interface TranscriptionProgress {
  currentChunk: number;
  totalChunks: number;
  percent: number;
}

let currentProgress: TranscriptionProgress | null = null;

export function getTranscriptionProgress(): TranscriptionProgress | null {
  return currentProgress;
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function fetchWithSSL(url: string, init?: RequestInit): Promise<Response> {
  // @ts-expect-error — Node fetch supports the `agent` option
  return fetch(url, { ...init, agent: httpsAgent });
}

function getFileDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { reject(new Error(`ffprobe failed with code ${code}`)); return; }
      const duration = parseFloat(output.trim());
      if (isNaN(duration)) { reject(new Error(`ffprobe returned invalid duration: "${output.trim()}"`)); return; }
      resolve(duration);
    });
    proc.on('error', (err) => reject(new Error(`ffprobe spawn failed: ${err.message}`)));
  });
}

function extractChunkAsWav(filePath: string, startSec: number, durationSec: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const proc = spawn('ffmpeg', [
      '-y',
      '-ss', String(startSec),
      '-t', String(durationSec),
      '-i', filePath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      'pipe:1',
    ]);
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8', 0, 500);
        reject(new Error(`ffmpeg chunk extraction failed (code ${code}): ${stderr}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
  });
}

async function transcribeChunk(baseUrl: string, wavBuffer: Buffer, timeoutMs: number): Promise<string> {
  const formData = new FormData();
  formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  formData.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetchWithSSL(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Connection: 'close' },
      body: formData,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Parakeet returned HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { text?: string };
    const text = data.text ?? '';
    if (!text) throw new Error('Parakeet: response OK but text field absent or empty');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const apiUrl = process.env['STT_API_URL'];
  if (!apiUrl) throw new Error('STT_API_URL is not configured');

  const baseUrl = apiUrl.replace(/\/$/, '');
  const timeoutMs = parseInt(process.env['STT_TIMEOUT_SECONDS'] ?? '600', 10) * 1000;
  const chunkSec = parseInt(process.env['STT_CHUNK_MINUTES'] ?? '5', 10) * 60;

  const duration = await getFileDuration(filePath);
  const numChunks = Math.ceil(duration / chunkSec);

  const parts: string[] = [];
  currentProgress = { currentChunk: 0, totalChunks: numChunks, percent: 0 };

  try {
    for (let i = 0; i < numChunks; i++) {
      const startSec = i * chunkSec;
      const wavBuffer = await extractChunkAsWav(filePath, startSec, chunkSec);
      try {
        const text = await transcribeChunk(baseUrl, wavBuffer, timeoutMs);
        parts.push(text.trim());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const cause = err instanceof Error && err.cause instanceof Error ? ` — cause: ${err.cause.message}` : '';
        throw new Error(`Chunk ${i + 1}/${numChunks} failed: ${msg}${cause}`);
      }
      currentProgress = {
        currentChunk: i + 1,
        totalChunks: numChunks,
        percent: Math.round(((i + 1) / numChunks) * 100),
      };
    }
  } finally {
    currentProgress = null;
  }

  return parts.filter(Boolean).join(' ');
}
