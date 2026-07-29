# Testing — openclaw-server

These are **manual / live smoke probes**, not a CI unit-test suite. They need a running server, real API keys, and usually a local audio file.

## Prerequisites

```bash
cp .env.example .env   # fill GEMINI_API_KEY, GROQ_API_KEY, SUPABASE_*, etc.
npm install
npm run dev            # http://localhost:3000
```

Place a sample file at the **repo root** as `MeetingTest.mp3` (used by `npm test` / `test:sample`).

## Scripts

| Command | What it does |
|---------|----------------|
| `GET /health` | Liveness JSON (`{ ok: true, ... }`) — no auth |
| `npm run test:api` | PowerShell: health check; optionally uploads if audio exists |
| `npm test` / `npm run test:sample` | Live E2E against `/upload-meeting` using `MeetingTest.mp3` |
| `npm run test:transcribe` | Direct Groq transcription smoke (needs keys + audio) |
| `npm run test:unit` | Pure MCP URL validation (no server) |
| `npm run list-crm-tools` | MCP discovery helper (needs CRM token / user) |
| `npm run list-cms-tools` | Same for CMS |
| `npm run list-rh-tools` | Same for RH |

**Important:** `npm test` is **not** a regression suite. It will fail if the server is down or keys/audio are missing.

## Quick checks

```bash
# Health (server must be running)
curl http://localhost:3000/health

# Full pipeline probe (Windows)
npm run test:api
# or
npm run test:sample
```

## Frontend pairing

RapidoMeet Vite app defaults to http://localhost:8080 with `VITE_EXPRESS_API_BASE_URL=http://localhost:3000`.
OAuth redirects use `FRONTEND_URL` / `CORS_ORIGIN` (see `.env.example`).
