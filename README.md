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
- Tag-based organization with parent/child tags
- **Projects**: group recordings with boolean tag queries (AND / OR / NOT, nested groups) and keep an LLM-generated running report, personal notes, contacts and documents for each one
- **Contacts**: people attached to one or more projects, with a dedicated page showing where each appears
- **Project documents**: drag & drop PDF, Word, PowerPoint, Excel, text and image files into a project and download them again
- **MCP server**: lets Claude query transcripts, summaries, projects, contacts and documents
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
│   │   ├── services/     llm.ts, stt.ts, file.ts, limits.ts, logStore.ts, projects.ts, tagQuery.ts, documents.ts
│   │   ├── watcher.ts    Chokidar file watcher + manual scan
│   │   └── index.ts      Server entry point
├── frontend/             React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── api/          Typed fetch wrappers
│       ├── components/   Reusable UI components
│       └── pages/        ListView, CalendarView, RecordDetail, TagsPage, ProjectsPage, ProjectDetail, ContactsPage, SettingsPage, LogsPage
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

## Projects, contacts and documents

**Projects** collect the recordings that match a *tag query* and maintain a running report built from
their summaries. The query is built visually, no syntax to learn: each group matches **ALL** (AND) or
**ANY** (OR) of its items; every tag or group can be negated with **NOT**; groups can be nested. For
example `(budget AND suppliers) OR NOT (internal AND hr)`. A live preview shows the resulting
expression and how many recordings match. Only recordings with a summary feed the report:

- **Update** adds the newly matching recordings to the existing report (one LLM call);
- **Regenerate from selection** rebuilds the report from scratch using the recordings you tick.

Both count against `LLM_DAILY_LIMIT`. Each project also has personal **notes**, **contacts** and
**documents**.

**Contacts** (name, role, email, mobile, notes) are shared: one contact can belong to several projects,
chosen from existing ones or created on the spot. The *Contacts* page lists everyone with the projects
they are linked to. Editing a contact changes it everywhere; removing it from a project keeps the contact.

**Documents** are added by drag & drop (or click) in the project page. Allowed types: `pdf doc docx ppt
pptx txt xls xlsx png jpg jpeg gif webp`, up to 50 MB each. Clicking a document downloads it. Files are
stored on the server's disk in `project-documents/<project id>/` next to the SQLite database (inside the
`data` volume with Docker), so **back up that folder together with the database**. If a reverse proxy sits
in front of AudioVault, make sure it allows large uploads (e.g. nginx `client_max_body_size 50m;`).

Notes, contacts and documents are never used to generate reports. They are, however, readable through the
[MCP server](#mcp-server) if you enable it.

## MCP server

AudioVault can be queried from Claude through a read-only [MCP](https://modelcontextprotocol.io) endpoint
served by the same process at `POST /mcp`. It exposes recordings (transcripts, summaries, tags), projects
(report, notes, recordings, contacts, documents) and contacts. It is stateless and answers with plain JSON
(no SSE streams, no sessions), so a reverse proxy needs nothing beyond forwarding `POST /mcp` and the
`Authorization` header.

**Enable it** by setting `MCP_TOKEN` (at least 16 random characters, e.g. `openssl rand -hex 32`) and
restarting. Without it `/mcp` answers `503`. Every request must send `Authorization: Bearer <token>`.
The same endpoint is reachable at whichever address reaches the service from the client machine: LAN IP,
Tailscale IP or the HTTPS name behind your reverse proxy.

### Claude Code

```bash
claude mcp add --transport http --scope user audiovault https://your-host/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

### Claude Desktop

Use the **local configuration file**, not *Settings → Connectors*:

- *Custom connectors* (Settings → Connectors) are contacted **from Anthropic's cloud**, not from your PC,
  so they cannot reach a server on a LAN, behind Tailscale or a VPN. Making AudioVault reachable from the
  internet just for this is not recommended: it exposes private data.
- *Local servers* declared in `claude_desktop_config.json` run on your PC and use its network, so all three
  addresses work. They are available in Claude Desktop only, **not in Cowork or on claude.ai**.

1. Install [Node.js](https://nodejs.org) 18+ on the PC (Claude Desktop launches the bridge through `npx`).
2. In Claude Desktop open *Settings → Developer → Edit Config* (file: `%APPDATA%\Claude\claude_desktop_config.json`
   on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) and add:

   ```json
   {
     "mcpServers": {
       "audiovault": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote", "https://your-host/mcp",
           "--transport", "http-only",
           "--header", "Authorization:${AUDIOVAULT_AUTH}"
         ],
         "env": { "AUDIOVAULT_AUTH": "Bearer <MCP_TOKEN>" }
       }
     }
   }
   ```

   The token goes through an environment variable because spaces inside `--header` values are mangled on
   Windows. If the URL is plain `http://` (a LAN or Tailscale IP without TLS) also add `"--allow-http"` to `args`.
3. Quit Claude Desktop completely (including the tray icon) and start it again. `audiovault` should appear
   under *Settings → Developer* as running; its logs are in `%APPDATA%\Claude\logs\mcp*.log`.

### Tools

| Tool | Purpose |
|---|---|
| `search_recordings` | Full-text + tag + date + status search; compact rows with snippets |
| `get_recordings` | Summaries, notes and metadata for up to 10 recordings |
| `read_transcript` | A transcript slice, or only the passages around a phrase (`query`) |
| `list_tags` | Tags with parent and recording counts |
| `list_projects` / `get_project` | Projects; `get_project` returns only the requested sections |
| `read_document` | Text of a project document (pdf, docx, pptx, xlsx, txt) or an image |
| `list_contacts` | Contacts and the projects they belong to |

Legacy binary `.doc`, `.ppt` and `.xls` files and scanned PDFs without a text layer cannot be read as text.

> Everything reachable through this endpoint (transcripts, contacts, documents, notes) is readable by
> whichever Claude client holds the token. Treat `MCP_TOKEN` like a password.

## Database

AudioVault uses SQLite via Drizzle ORM. The database is created automatically at the path specified by `DB_PATH` (default: `./data/audiovault.db`).

Uploaded project documents are not stored in the database: they live in `project-documents/` in the same
directory as the database file, so back up both.

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
| PATCH | `/api/tags/:id` | Rename a tag or change its parent |
| DELETE | `/api/tags/:id` | Delete tag |
| GET | `/api/projects` | List projects with counts |
| POST | `/api/projects` | Create a project (`title`, `tag_query`) |
| POST | `/api/projects/preview` | Count the recordings a `tag_query` would match (nothing saved) |
| GET | `/api/projects/:id` | Project detail with included / pending / excluded recordings |
| PATCH | `/api/projects/:id` | Update title, `tag_query`, report or notes |
| DELETE | `/api/projects/:id` | Delete project (and its uploaded documents) |
| POST | `/api/projects/:id/generate` | Add newly matching recordings to the report |
| POST | `/api/projects/:id/regenerate` | Rebuild the report from a selection of recordings |
| GET | `/api/projects/:id/contacts` | Contacts linked to a project |
| POST | `/api/projects/:id/contacts` | Link an existing contact (`contact_id`) or create and link one (`contact`) |
| DELETE | `/api/projects/:id/contacts/:contactId` | Unlink a contact (the contact is kept) |
| GET | `/api/projects/:id/documents` | List a project's documents |
| POST | `/api/projects/:id/documents` | Upload one document (multipart, field `file`) |
| GET | `/api/projects/:id/documents/:docId/download` | Download a document |
| DELETE | `/api/projects/:id/documents/:docId` | Delete a document |
| GET | `/api/contacts` | All contacts with the projects they belong to |
| POST | `/api/contacts` | Create a contact |
| PATCH | `/api/contacts/:id` | Edit a contact |
| DELETE | `/api/contacts/:id` | Delete a contact |
| POST | `/mcp` | MCP endpoint (needs `MCP_TOKEN`, see above) |
| GET | `/api/stats` | Get statistics |
| GET | `/api/limits/today` | Get today's LLM usage |
| GET | `/api/settings` | Get all settings |
| PATCH | `/api/settings` | Update settings (takes effect immediately) |
| GET | `/api/logs` | Stream recent application logs |
| GET | `/api/health` | Health check |

## License

MIT
