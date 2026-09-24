import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import * as fs from 'fs';

const DEFAULT_PROMPT = `You are an assistant that creates structured notes from audio transcriptions.
Given the following transcription, produce exactly three sections:

## Summary
A concise summary in under 200 words.

## Key Points
- bullet points of the main topics discussed

## Action Items
- bullet points of any tasks or follow-ups identified (write "None" if absent)

Transcription:
{transcription}`;

export interface LLMResult {
  summary: string;
  notes: string;
}

function loadPrompt(): string {
  // 1. Check DB/runtime setting (set by Settings UI → process.env)
  const dbPrompt = process.env['LLM_PROMPT'];
  if (dbPrompt && dbPrompt.trim()) {
    return dbPrompt;
  }

  // 2. Check prompt file
  const promptFile = process.env['LLM_PROMPT_FILE'];
  if (promptFile) {
    try {
      const content = fs.readFileSync(promptFile, 'utf-8');
      if (content.trim()) return content;
    } catch (_e) {
      console.warn(`Could not read prompt file ${promptFile}, using default`);
    }
  }

  // 3. Hardcoded default
  return DEFAULT_PROMPT;
}

function buildPrompt(transcription: string): string {
  const template = loadPrompt();
  return template.replace('{transcription}', () => transcription);
}

/**
 * Parse the LLM response into summary + notes.
 * Works with any language — splits on ## headers.
 * First section → summary, remaining sections → notes.
 */
function parseResponse(rawText: string): LLMResult {
  // Split on ## headers, keeping the header text
  const sections = rawText.split(/(?=^##\s+)/m).filter((s) => s.trim());

  if (sections.length === 0) {
    return { summary: rawText.trim(), notes: '' };
  }

  // First ## section → summary (strip the header line)
  const firstSection = sections[0];
  const summary = firstSection.replace(/^##\s+.*\n/, '').trim();

  // Remaining sections → notes (keep headers intact)
  const notes = sections
    .slice(1)
    .map((s) => s.trim())
    .join('\n\n');

  return { summary, notes };
}

async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const model = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
}

async function generateWithOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const model = process.env['OPENAI_MODEL'] ?? 'gpt-4o';
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}

async function generateRaw(prompt: string): Promise<string> {
  const provider = (process.env['LLM_PROVIDER'] ?? 'gemini').toLowerCase();
  if (provider === 'openai') {
    return generateWithOpenAI(prompt);
  }
  return generateWithGemini(prompt);
}

export async function generateSummary(transcription: string): Promise<LLMResult> {
  const prompt = buildPrompt(transcription);
  const rawText = await generateRaw(prompt);
  return parseResponse(rawText);
}

export interface ProjectMeeting {
  date: string;
  title: string;
  summary: string;
}

const PROJECT_REPORT_INSTRUCTIONS = `Sei un assistente che mantiene un report di sintesi per un progetto composto da più riunioni.
Produci un report in Markdown con esattamente queste sezioni, in questo ordine:

## Fatto
Attività concluse emerse dalle riunioni.

## In corso
Attività attualmente in corso.

## Da fare
Attività pianificate ma non ancora iniziate.

## Punti da investigare
Domande aperte o argomenti che richiedono approfondimento.

## Da tenere a mente
Decisioni, vincoli o informazioni rilevanti da non perdere.

Scrivi elenchi puntati concisi. Se una sezione non ha contenuti, scrivi "Nessuno".`;

function buildProjectPrompt(existingReport: string | null, meetings: ProjectMeeting[]): string {
  const meetingsBlock = meetings
    .map((m) => `### ${m.date} — ${m.title}\n${m.summary}`)
    .join('\n\n');

  if (existingReport && existingReport.trim()) {
    return `${PROJECT_REPORT_INSTRUCTIONS}

Esiste già un report per questo progetto, basato sulle riunioni precedenti. Aggiornalo integrando le nuove riunioni riportate sotto: sposta le attività completate, aggiorna quelle in corso, aggiungi i nuovi punti, e conserva le informazioni ancora valide che non sono contraddette dalle nuove riunioni.

Report attuale:
${existingReport}

Nuove riunioni:
${meetingsBlock}`;
  }

  return `${PROJECT_REPORT_INSTRUCTIONS}

Riunioni:
${meetingsBlock}`;
}

export async function generateProjectReport(
  existingReport: string | null,
  meetings: ProjectMeeting[],
): Promise<string> {
  const prompt = buildProjectPrompt(existingReport, meetings);
  return generateRaw(prompt);
}
