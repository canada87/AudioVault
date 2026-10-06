# AudioVault

AudioVault is a self-hosted web application for managing, transcribing, and summarizing audio recordings. It watches a directory for MP4/MKV files, automatically registers them, and provides a rich UI for transcription (via Scriberr STT API) and AI-powered summarization (via Google Gemini or OpenAI).

## Features

- Automatic file watching and registration (MP4, MKV)
- Scheduled or on-demand transcription via Scriberr STT
- AI-powered summarization — choose between **Google Gemini** or **OpenAI** as provider
- Switchable LLM provider and model at runtime from the Settings UI
- Full-text search across transcriptions, summaries, and display names
- Calendar and list views
- Audio player with waveform visualization
- Tag-based organization
- Markdown export
- Daily LLM rate limiting
- In-app log viewer
- Import transcriptions from `.txt` files

## Prerequisites

- Node.js 20+
- npm 9+
- `ffprobe` (part of ffmpeg) installed and in PATH
- A [Scriberr](https://github.com/bofenghuang/scriberr) instance (for transcription)
- A Google Gemini API key **and/or** an OpenAI API key (for summarization)

## Project Structure

```
audiovault/
├── backend/              Node.js + Fastify + SQLite + Drizzle ORM
│   ├── src/
│   │   ├── db/           Drizzle schema and database client
│   │   ├── routes/       Fastify route handlers (incl. the /mcp endpoint)
│   │   ├── mcp/          MCP server: tool definitions, queries, document text extraction
│   │   ├── scheduler/    Cron-based transcription and summarizer pollers
│   │   ├── services/     llm.ts, stt.ts, file.ts, limits.ts, logStore.ts
│   │   ├── watcher.ts    Chokidar file watcher + manual scan
│   │   └── index.ts      Server entry point
├── frontend/             React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── api/          Typed fetch wrappers
│       ├── components/   Reusable UI components
│       └── pages/        CalendarView, ListView, RecordDetail, SettingsPage, LogsPage
├── ecosystem.config.js   PM2 configuration
└── docker-compose.yml    Docker deployment
```

## Setup

### 1. Clone and install dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your configuration:

| Variable | Description | Required |
|----------|-------------|----------|
| `AUDIO_DIR` | Path to directory containing MP4/MKV recordings | Yes |
| `STT_API_URL` | URL of your Scriberr instance | For transcription |
| `STT_API_KEY` | Scriberr API key | For transcription |
| `LLM_PROVIDER` | LLM provider: `gemini` (default) or `openai` | No |
| `GEMINI_API_KEY` | Google Gemini API key | If using Gemini |
| `GEMINI_MODEL` | Gemini model (default: `gemini-2.5-flash`) | No |
| `OPENAI_API_KEY` | OpenAI API key | If using OpenAI |
| `OPENAI_MODEL` | OpenAI model (default: `gpt-4o`) | No |
| `LLM_DAILY_LIMIT` | Max LLM calls per day (default: `5`) | No |
| `TRANSCRIPTION_CRON` | Cron schedule for auto-transcription (default: `0 4 * * *`) | No |
| `LLM_POLL_INTERVAL` | Minutes between summarizer polls (default: `30`) | No |
| `PORT` | Backend server port (default: `3000`) | No |
| `HOST` | Backend bind address (default: `0.0.0.0`) | No |
| `DB_PATH` | SQLite database file path (default: `./data/audiovault.db`) | No |
| `MCP_TOKEN` | Bearer token that enables the MCP endpoint (min 16 chars); see [MCP server](#mcp-server) | No |

> **Switching provider at runtime:** all LLM settings (`LLM_PROVIDER`, `GEMINI_MODEL`, `OPENAI_MODEL`) can be changed from the Settings page without restarting the server.

### 3. Audio file naming convention

AudioVault expects MP4 or MKV files named in the format:

```
YYYY-MM-DD HH-MM-SS.mp4
YYYY-MM-DD HH-MM-SS.mkv
```

Example: `2024-01-15 14-30-00.mp4`

Files not matching this pattern will be skipped.

### 4. Custom LLM prompt

You can customize the summarization prompt from the Settings UI or by pointing `LLM_PROMPT_FILE` to a text file. Use `{transcription}` as the placeholder for the transcription text. The prompt applies to whichever provider is active.

## Development

Run backend and frontend concurrently in development:

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

The frontend dev server runs on port 5173 and proxies `/api` requests to the backend on port 3000.

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Production

### Option 1: Build and run with PM2

```bash
# Build frontend
cd frontend
npm run build

# Build backend
cd ../backend
npm run build

# Start with PM2
cd ..
pm2 start ecosystem.config.js
```

In production, the backend serves the frontend's static files from `frontend/dist`.

### Option 2: Docker Compose

```bash
# Set required environment variables
export AUDIO_DIR=/path/to/your/recordings
export GEMINI_API_KEY=your_gemini_key      # or use OPENAI_API_KEY
export STT_API_URL=https://your-scriberr-instance.com

docker-compose up -d
```

The application will be available at [http://localhost:3000](http://localhost:3000).

## MCP server

AudioVault can be queried from Claude (Claude Code, Claude Desktop, ...) through a read-only
[MCP](https://modelcontextprotocol.io) endpoint served by the same process at `POST /mcp`. It exposes
recordings (transcripts, summaries, tags), projects (report, notes, recordings, contacts, documents)
and contacts.

**Enable it** by setting `MCP_TOKEN` (at least 16 random characters, e.g. `openssl rand -hex 32`) and
restarting. Without it `/mcp` answers `503`. Every request must send `Authorization: Bearer <token>`.

**Connect Claude Code** (use whichever URL reaches the service from that machine — LAN IP, Tailscale IP or
the HTTPS name behind your reverse proxy; they all hit the same endpoint):

```bash
claude mcp add --transport http --scope user audiovault https://your-host/mcp   --header "Authorization: Bearer <MCP_TOKEN>"
```

Claude Desktop only launches local (stdio) servers, so bridge to the URL with `mcp-remote`:

```json
{
  "mcpServers": {
    "audiovault": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-host/mcp", "--header", "Authorization:${AUDIOVAULT_AUTH}"],
      "env": { "AUDIOVAULT_AUTH": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

The endpoint is stateless and answers with plain JSON (no SSE streams, no sessions), so a reverse proxy
needs no special configuration beyond forwarding `POST /mcp`.

| Tool | Purpose |
|---|---|
| `search_recordings` | Full-text + tag + date + status search; compact rows with snippets |
| `get_recordings` | Summaries, notes and metadata for up to 10 recordings |
| `read_transcript` | A transcript slice, or only the passages around a phrase (`query`) |
| `list_tags` | Tags with parent and recording counts |
| `list_projects` / `get_project` | Projects; `get_project` returns only the requested sections |
| `read_document` | Text of a project document (pdf, docx, pptx, xlsx, txt) or an image |
| `list_contacts` | Contacts and the projects they belong to |

> Everything reachable through this endpoint (transcripts, contacts, documents, notes) is readable by
> whichever Claude client holds the token. Treat `MCP_TOKEN` like a password.

## Database

AudioVault uses SQLite via Drizzle ORM. The database is created automatically at the path specified by `DB_PATH` (default: `./data/audiovault.db`).

To run migrations manually:

```bash
cd backend
npm run db:migrate
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/records` | List records with pagination, filtering, search |
| GET | `/api/records/:id` | Get single record with tags |
| PATCH | `/api/records/:id` | Rename or update tags |
| DELETE | `/api/records/:id` | Delete record and audio file |
| DELETE | `/api/records/:id/audio` | Delete only the audio file |
| POST | `/api/records/:id/transcribe` | Trigger transcription |
| POST | `/api/records/:id/summarize` | Trigger summarization |
| GET | `/api/records/:id/export` | Download Markdown export |
| POST | `/api/records/import` | Import transcriptions from `.txt` files |
| POST | `/api/records/scan` | Trigger manual directory scan |
| GET | `/api/audio/:id` | Stream audio (supports HTTP Range) |
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create tag |
| DELETE | `/api/tags/:id` | Delete tag |
| GET | `/api/stats` | Get statistics |
| GET | `/api/limits/today` | Get today's LLM usage |
| GET | `/api/settings` | Get all settings |
| PATCH | `/api/settings` | Update settings (takes effect immediately) |
| GET | `/api/logs` | Stream recent application logs |
| GET | `/api/health` | Health check |

## License

MIT
