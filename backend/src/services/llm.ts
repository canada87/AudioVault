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
  const promptFile = process.env['LLM_PROMPT_FILE'];
  if (promptFile) {
    try {
      return fs.readFileSync(promptFile, 'utf-8');
    } catch (_e) {
      console.warn(`Could not read prompt file ${promptFile}, using default`);
    }
  }
  return DEFAULT_PROMPT;
}

function buildPrompt(transcription: string): string {
  const template = loadPrompt();
  return template.replace('{transcription}', () => transcription);
}

function parseResponse(rawText: string): LLMResult {
  // Extract the Summary section
  const summaryMatch = rawText.match(/##\s*Summary\s*\n([\s\S]*?)(?=##\s*Key Points|##\s*Action Items|$)/i);
  const keyPointsMatch = rawText.match(/##\s*Key Points\s*\n([\s\S]*?)(?=##\s*Action Items|$)/i);
  const actionItemsMatch = rawText.match(/##\s*Action Items\s*\n([\s\S]*?)(?=##\s|$)/i);

  const summary = summaryMatch ? summaryMatch[1]?.trim() ?? '' : rawText.trim();

  // Combine Key Points and Action Items into notes
  const keyPoints = keyPointsMatch ? keyPointsMatch[1]?.trim() ?? '' : '';
  const actionItems = actionItemsMatch ? actionItemsMatch[1]?.trim() ?? '' : '';

  let notes = '';
  if (keyPoints) {
    notes += `## Key Points\n${keyPoints}`;
  }
  if (actionItems) {
    notes += notes ? `\n\n## Action Items\n${actionItems}` : `## Action Items\n${actionItems}`;
  }

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
