# CLAUDE.md — AudioVault

Developer guide for Claude Code sessions on this project.

## Project overview

AudioVault is a self-hosted audio management app. It watches a directory for MP4/MKV recordings, transcribes them via Scriberr (Parakeet), and summarizes them with an LLM (Google Gemini or OpenAI). Single-binary deployment: the Fastify backend serves the React frontend's static build.

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20, Fastify 4, SQLite (better-sqlite3), Drizzle ORM, TypeScript |
| Frontend | React 18, Vite, TailwindCSS, TanStack React Query, React Router |
| LLM | `@google/generative-ai` (Gemini) or `openai` SDK |
| Process mgmt | PM2 (`ecosystem.config.js`) or Docker Compose |

## Repo layout

```
backend/src/
  index.ts              — entry point: env validation (zod), Fastify setup, DB settings load, scheduler start
  db/
    schema.ts           — Drizzle table definitions (records, tags, recordTags, processingLog, dailyLimits, settings)
    index.ts            — better-sqlite3 + Drizzle client singleton
  routes/
    records.ts          — /api/records/* (CRUD, transcribe, summarize, export, import, scan)
    tags.ts             — /api/tags/*
    audio.ts            — /api/audio/:id (streaming with Range support)
    stats.ts            — /api/stats, /api/limits/today, /api/settings GET+PATCH, /api/logs
    logs.ts             — /api/logs (SSE log stream)
  services/
    llm.ts              — generateSummary(): branches on LLM_PROVIDER → Gemini or OpenAI
    stt.ts              — Scriberr STT integration (polling-based)
    file.ts             — audio file helpers
    limits.ts           — daily LLM call counting (dailyLimits table)
    logStore.ts         — in-memory ring buffer for log SSE
  scheduler/
    transcription.ts    — node-cron job (TRANSCRIPTION_CRON, default 4 AM)
    summarizer.ts       — polling loop (LLM_POLL_INTERVAL minutes)
  watcher.ts            — chokidar directory watcher + manual scanDirectory()

frontend/src/
  App.tsx               — React Router layout and routes
  pages/
    ListView.tsx        — main record list with search/filter/pagination
    CalendarView.tsx    — calendar-based browsing
    RecordDetail.tsx    — single record: audio player, transcript, summary, tags
    SettingsPage.tsx    — all runtime settings + LLM usage chart + import tool
    LogsPage.tsx        — live log viewer
  components/           — StatusBadge, TagPill, ConfirmDialog, FolderBrowser, DurationDisplay
  api/                  — typed fetch wrappers (records, tags, settings, stats)
```

## Key architectural patterns

### Settings system
Runtime config lives in two places that mirror each other:
1. `process.env` — source of truth at runtime
2. `settings` DB table — persisted across restarts

At boot (`index.ts`), DB values are loaded into `process.env`. On PATCH `/api/settings`, both DB and `process.env` are updated simultaneously. The `ALLOWED_KEYS` set in `stats.ts` controls what can be mutated via API.

Keys that DB always overrides (even if env is set): `LLM_PROMPT`, `LLM_PROVIDER`, `GEMINI_MODEL`, `OPENAI_MODEL`.

### LLM provider switching
`backend/src/services/llm.ts` reads `process.env['LLM_PROVIDER']` at call time (not at startup), so switching provider via Settings takes effect on the next summarization without restart. The same `parseResponse()` and prompt logic is shared by both providers.

### Record status lifecycle
```
pending → transcribing → transcribed → processing → done
                                                  ↘ error
```
The summarizer poller picks up `transcribed` records. The transcription scheduler picks up `pending` records.

### File naming convention
Watcher only accepts filenames matching `/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mp4|mkv)$/`. This is how `recorded_at` is derived — there is no other timestamp source.

## Dev commands

```bash
# Backend (hot reload via tsx watch)
cd backend && npm run dev

# Frontend (Vite HMR on :5173, proxies /api → :3000)
cd frontend && npm run dev

# Production build
cd frontend && npm run build
cd backend && npm run build

# DB migrations
cd backend && npm run db:migrate

# Type-check backend
cd backend && npx tsc --noEmit
```

## Environment variables

All LLM-related vars can be changed at runtime via Settings UI — no restart needed.

| Variable | Default | Notes |
|---|---|---|
| `AUDIO_DIR` | — | Required for watcher |
| `STT_API_URL` | — | Scriberr endpoint |
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai` |
| `GEMINI_API_KEY` | — | Required if provider=gemini |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `OPENAI_API_KEY` | — | Required if provider=openai |
| `OPENAI_MODEL` | `gpt-4o` | |
| `LLM_DAILY_LIMIT` | `5` | Enforced via dailyLimits table |
| `LLM_PROMPT` | — | Set by Settings UI, overrides file |
| `LLM_PROMPT_FILE` | — | Path to .txt prompt template |
| `TRANSCRIPTION_CRON` | `0 4 * * *` | node-cron expression |
| `LLM_POLL_INTERVAL` | `30` | Minutes |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/audiovault.db` | |

## Database schema (summary)

- `records` — core table: `id`, `original_name`, `display_name`, `recorded_at` (unix), `file_path`, `audio_deleted`, `transcription`, `summary`, `notes`, `status`, timestamps
- `tags` / `record_tags` — many-to-many tagging
- `processingLog` — audit trail for transcription and summarization (scheduler vs manual, success vs error)
- `dailyLimits` — one row per UTC date, `llm_count` incremented per call
- `settings` — key/value pairs persisted from Settings UI

## Things to watch out for

- **SQLite concurrency**: better-sqlite3 is synchronous. Avoid parallel writes from multiple async paths; the existing code sequences DB operations carefully.
- **`process.env` mutation**: settings are patched directly into `process.env` at runtime. This works in a single-process deployment (PM2 single instance, Docker single container). Do not assume env is immutable.
- **LLM_PROVIDER read at call time**: `generateSummary()` reads `process.env['LLM_PROVIDER']` on every call. Keep it that way — it's what enables runtime switching.
- **File paths**: `watcher.ts` normalizes all paths to forward slashes via `normalizePath()`. Always use normalized paths when querying `records.file_path`.
- **Frontend `EDITABLE_KEYS`**: adding a new setting to the backend `ALLOWED_KEYS` set also requires adding it to `EDITABLE_KEYS` in `SettingsPage.tsx` for it to appear in the UI.
