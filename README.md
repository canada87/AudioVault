# AudioVault

AudioVault is a self-hosted web application for managing, transcribing, and summarizing audio recordings. It watches a directory for MP4 files, automatically registers them, and provides a rich UI for transcription (via Scriberr STT API) and AI-powered summarization (via Google Gemini).

## Features

- Automatic file watching and registration
- Scheduled or on-demand transcription via Scriberr STT
- AI-powered summarization via Google Gemini
- Full-text search across transcriptions and summaries
- Calendar and list views
- Audio player with waveform visualization
- Tag-based organization
- Markdown export
- Daily LLM rate limiting

## Prerequisites

- Node.js 20+
- npm 9+
- `ffprobe` (part of ffmpeg) installed and in PATH
- A [Scriberr](https://github.com/bofenghuang/scriberr) instance (for transcription)
- A Google Gemini API key (for summarization)

## Project Structure

```
audiovault/
├── backend/       Node.js + Fastify + SQLite + Drizzle ORM
├── frontend/      React 18 + Vite + Tailwind CSS
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
| `AUDIO_DIR` | Path to directory containing MP4 recordings | Yes |
| `STT_API_URL` | URL of your Scriberr instance | For transcription |
| `STT_API_KEY` | Scriberr API key | For transcription |
| `GEMINI_API_KEY` | Google Gemini API key | For summarization |
| `GEMINI_MODEL` | Gemini model to use (default: `gemini-1.5-flash`) | No |
| `LLM_DAILY_LIMIT` | Max LLM calls per day (default: `5`) | No |
| `TRANSCRIPTION_CRON` | Cron schedule for auto-transcription (default: `0 4 * * *`) | No |
| `LLM_POLL_INTERVAL` | Minutes between summarizer polls (default: `30`) | No |
| `PORT` | Backend server port (default: `3000`) | No |
| `HOST` | Backend bind address (default: `0.0.0.0`) | No |
| `DB_PATH` | SQLite database file path (default: `./data/audiovault.db`) | No |

### 3. Audio file naming convention

AudioVault expects MP4 files named in the format:

```
YYYY-MM-DD HH-MM-SS.mp4
```

Example: `2024-01-15 14-30-00.mp4`

Files not matching this pattern will be skipped.

### 4. Custom LLM prompt

You can customize the summarization prompt by editing `backend/config/prompt.txt`. Use `{transcription}` as the placeholder for the transcription text.

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
export GEMINI_API_KEY=your_key_here
export STT_API_URL=https://your-scriberr-instance.com
export STT_API_KEY=your_stt_key

docker-compose up -d
```

The application will be available at [http://localhost:3000](http://localhost:3000).

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
| GET | `/api/audio/:id` | Stream audio (supports HTTP Range) |
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create tag |
| DELETE | `/api/tags/:id` | Delete tag |
| GET | `/api/stats` | Get statistics |
| GET | `/api/limits/today` | Get today's LLM usage |
| GET | `/api/settings` | Get settings |
| PATCH | `/api/settings` | Update settings |
| GET | `/api/health` | Health check |

## License

MIT
