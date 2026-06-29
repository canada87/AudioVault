import { spawn } from 'child_process';
import https from 'https';

export interface TranscriptionProgress {
  currentChunk: number;
  totalChunks: number;
  percent: number;
}

// Progress is no longer tracked (Parakeet is now synchronous); always returns null.
export function getTranscriptionProgress(): TranscriptionProgress | null {
  return null;
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function fetchWithSSL(url: string, init?: RequestInit): Promise<Response> {
  // @ts-expect-error — Node fetch supports the `agent` option
  return fetch(url, { ...init, agent: httpsAgent });
}

function convertToWav(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', filePath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      'pipe:1',
    ]);

    const stderrChunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8', 0, 500);
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    ffmpeg.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
  });
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const apiUrl = process.env['STT_API_URL'];
  if (!apiUrl) throw new Error('STT_API_URL is not configured');

  const timeoutMs = parseInt(process.env['STT_TIMEOUT_SECONDS'] ?? '600', 10) * 1000;

  const wavBuffer = await convertToWav(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  formData.append('response_format', 'json');

  const headers: Record<string, string> = { Connection: 'close' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetchWithSSL(`${apiUrl.replace(/\/$/, '')}/v1/audio/transcriptions`, {
      method: 'POST',
      headers,
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
