import * as fs from 'fs';
import * as path from 'path';
import https from 'https';

interface ParakeetStatus {
  status: string;
  job_id?: string;
  current_chunk?: number;
  total_chunks?: number;
  partial_text?: string;
}

export interface STTConfig {
  apiUrl: string;
  model: string;
  pollIntervalSeconds: number;
  pollTimeoutSeconds: number;
}

export interface TranscriptionProgress {
  currentChunk: number;
  totalChunks: number;
  percent: number;
}

// In-memory progress (Parakeet is single-job, so one global state suffices)
let currentProgress: TranscriptionProgress | null = null;

export function getTranscriptionProgress(): TranscriptionProgress | null {
  return currentProgress;
}

// Agent for self-signed certificates
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function fetchWithSSL(url: string, init?: RequestInit): Promise<Response> {
  // @ts-expect-error — Node fetch supports the `agent` option
  return fetch(url, { ...init, agent: httpsAgent });
}

function getConfig(): STTConfig {
  return {
    apiUrl: process.env['STT_API_URL'] ?? '',
    model: process.env['STT_MODEL'] ?? 'istupakov/parakeet-tdt-0.6b-v3-onnx',
    pollIntervalSeconds: parseInt(process.env['STT_POLL_INTERVAL_SECONDS'] ?? '5', 10),
    pollTimeoutSeconds: parseInt(process.env['STT_POLL_TIMEOUT_SECONDS'] ?? '300', 10),
  };
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mkv': return 'video/x-matroska';
    case '.mp4': return 'video/mp4';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.webm': return 'video/webm';
    default: return 'application/octet-stream';
  }
}

async function submitTranscription(filePath: string, config: STTConfig): Promise<void> {
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const contentType = getContentType(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: contentType }), fileName);
  formData.append('model', config.model);
  formData.append('response_format', 'verbose_json');

  // Fire-and-forget: the proxy may return 504 before the server finishes
  // processing, but the job starts anyway. We track progress via /status.
  try {
    await fetchWithSSL(`${config.apiUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
  } catch {
    // Expected — proxy may close the connection before the job finishes
  }
}

async function pollForTranscript(config: STTConfig): Promise<string> {
  const startTime = Date.now();
  const timeoutMs = config.pollTimeoutSeconds * 1000;
  const pollIntervalMs = config.pollIntervalSeconds * 1000;

  let jobSeen = false;
  let finalText = '';
  currentProgress = null;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const res = await fetchWithSSL(`${config.apiUrl}/status`);
    const data = (await res.json()) as ParakeetStatus;

    const status = data.status ?? '';
    const jobId = data.job_id ?? '';
    const partial = data.partial_text ?? '';
    const chunk = data.current_chunk ?? 0;
    const total = data.total_chunks ?? 0;

    if (jobId) jobSeen = true;

    // Update progress
    if (total > 0) {
      currentProgress = {
        currentChunk: chunk,
        totalChunks: total,
        percent: Math.round((chunk / total) * 100),
      };
    }

    // Capture partial text before any break — the idle response after
    // job completion may still carry the final chunk's cumulative text
    // that the last `transcribing` poll hadn't yet observed.
    if (partial && partial.length >= finalText.length) {
      finalText = partial;
    }

    // Still uploading — server idle, no job yet
    if (status === 'idle' && !jobId && !jobSeen) {
      currentProgress = null;
      continue;
    }

    // Job finished — server back to idle after having seen a job
    if (status === 'idle' && !jobId && jobSeen) {
      currentProgress = { currentChunk: total || 1, totalChunks: total || 1, percent: 100 };
      break;
    }
  }

  // Grace-period poll: the server may still be flushing the last chunk's
  // partial_text right as it transitions to idle. One extra read catches it.
  try {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, 2000)));
    const res = await fetchWithSSL(`${config.apiUrl}/status`);
    const data = (await res.json()) as ParakeetStatus;
    const partial = data.partial_text ?? '';
    if (partial && partial.length > finalText.length) {
      finalText = partial;
    }
  } catch {
    // Best-effort — keep whatever finalText we already have
  }

  if (!finalText && !jobSeen) {
    currentProgress = null;
    throw new Error(`Transcription timed out after ${config.pollTimeoutSeconds}s — no job was started`);
  }

  if (!finalText) {
    currentProgress = null;
    throw new Error('Transcription completed but no text was returned');
  }

  return finalText;
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const config = getConfig();

  if (!config.apiUrl) {
    throw new Error('STT_API_URL is not configured');
  }

  // Start upload in background and poll simultaneously
  const uploadPromise = submitTranscription(filePath, config);
  const transcript = await pollForTranscript(config);

  // Make sure the upload promise settles
  await uploadPromise;

  currentProgress = null;
  return transcript;
}
