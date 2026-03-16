import { GoogleGenerativeAI } from '@google/generative-ai';
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

export async function generateSummary(transcription: string): Promise<LLMResult> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = process.env['GEMINI_MODEL'] ?? 'gemini-1.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });

  const prompt = buildPrompt(transcription);
  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  return parseResponse(text);
}
