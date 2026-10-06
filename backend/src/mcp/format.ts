import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Output helpers shared by the MCP tools. Everything is kept compact on purpose: the consumer is an
// LLM, so every token spent on whitespace, nulls or unrequested fields is wasted context.

// Drops null/undefined/empty-string fields so only information that exists is sent.
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      out[k] = compact(v);
    }
    return out as T;
  }
  return value;
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(compact(data)) }] };
}

// Domain errors (unknown id, bad tag name...) are reported as tool errors the model can act on.
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

// recorded_at comes from a file name that was parsed as server-local time (see watcher.ts), so
// format it with local getters to give back the same wall-clock time the file name shows.
export function formatDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface TextSlice {
  total_length: number;
  offset: number;
  returned: number;
  next_offset: number | null;
  text: string;
}

export function sliceText(text: string, offset: number, length: number): TextSlice {
  const start = Math.min(offset, text.length);
  const end = Math.min(start + length, text.length);
  return {
    total_length: text.length,
    offset: start,
    returned: end - start,
    next_offset: end < text.length ? end : null,
    text: text.slice(start, end),
  };
}

export interface Excerpt {
  offset: number;
  text: string;
}

// Case-insensitive phrase search returning short passages instead of the whole text. Matches whose
// context windows overlap are merged so the same words are never sent twice.
export function findExcerpts(
  text: string,
  phrase: string,
  contextChars: number,
  maxExcerpts: number,
): { match_count: number; excerpts: Excerpt[] } {
  const haystack = text.toLowerCase();
  const needle = phrase.trim().toLowerCase();
  if (needle.length === 0) return { match_count: 0, excerpts: [] };

  const windows: Array<{ start: number; end: number }> = [];
  let matchCount = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    matchCount++;
    const start = Math.max(0, at - contextChars);
    const end = Math.min(text.length, at + needle.length + contextChars);
    const last = windows[windows.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else windows.push({ start, end });
    from = at + needle.length;
  }

  return {
    match_count: matchCount,
    excerpts: windows.slice(0, maxExcerpts).map((w) => ({ offset: w.start, text: text.slice(w.start, w.end) })),
  };
}
