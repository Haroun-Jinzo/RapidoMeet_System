# openclaw-server

Express backend for **RapidoMeet**: upload meeting audio → transcribe → extract structured data → route MCP actions → execute (with human confirmation for critical writes).

Companion frontend: sibling repo `rapidomeet` (e.g. `https://meet.rapidosoftware.com`).

## Quick start

```bash
cp .env.example .env   # fill SUPABASE_*, GROQ_API_KEY, GEMINI_API_KEY, CORS_ORIGIN, FRONTEND_URL
npm install
npm run dev            # http://localhost:3000
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Nodemon + `ts-node` |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run test:api` | Health smoke (`test-api.ps1`) |
| `npm run list-crm-tools` | Live CRM MCP tool discovery |
| `npm run list-cms-tools` | Live CMS MCP tool discovery → regenerates map |
| `npm run list-rh-tools` | Live RH MCP tool discovery → regenerates map |

See [START-HERE.md](./START-HERE.md) and [TESTING.md](./TESTING.md).

## What this server does

1. Accepts authenticated `POST /upload-meeting` (multipart audio + metadata).
2. Transcribes with **Groq** (Whisper), optionally chunking large files.
3. Detects a **skill** (`skills/*.md`) and extracts tasks / decisions / prospects with an LLM (`extract.ts`).
4. **Routes** extraction into a list of tool actions (`router.ts`) — the model chooses tools from a text catalog, not live MCP schemas.
5. **Dispatches** actions (`dispatcher.ts`):
   - `crm_*` → RapidoCRM MCP (OAuth)
   - `cms_*` → RapidoCMS MCP (OAuth)
   - `rh_*` → Rapido RH MCP (OAuth)
   - `calendar_create_event` → Google Calendar API
   - `db_save_task` → local Supabase
   - other → n8n MCP hub
6. Critical writes pause for **confirmation** (in-app panel and/or Telegram).
7. Persists results to Supabase; streams progress over SSE.

## Documentation map

| Doc | Content |
|-----|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Pipeline, MCP model, auth, code map |
| [START-HERE.md](./START-HERE.md) | Local run checklist |
| [TESTING.md](./TESTING.md) | Smoke / probe scripts |
| [OPENCLAW_MCP_INTEGRATION.md](./OPENCLAW_MCP_INTEGRATION.md) | Legacy OpenClaw WS notes (optional) |
| `.env.example` | All environment variables |

## Frontend wiring

The SPA must build with a **public** Express URL:

```env
VITE_EXPRESS_API_BASE_URL=https://your-api-host
```

Without it, the frontend falls back to Supabase Edge Functions (`transcribe-audio`) and never hits this server.

On this server for production:

```env
FRONTEND_URL=https://meet.rapidosoftware.com
CORS_ORIGIN=https://meet.rapidosoftware.com
BYPASS_AUTH=false
```

## Project layout (high level)

```
src/
  index.ts              # Express app, /upload-meeting pipeline
  transcribe.ts         # Groq STT (+ optional local whisper if enabled)
  extract.ts            # LLM extraction → tasks/decisions/prospects
  router.ts             # LLM intent routing → MCP action list
  dispatcher.ts         # Execute actions (CRM/CMS/RH/n8n/calendar/DB)
  session.ts / memory.ts
  skill-loader.ts       # skills/*.md registry
  auth/                 # OAuth routers (CRM, CMS, RH, Google, Telegram)
  config/               # Tool catalogs + MCP name maps
  integrations/         # ConnectionsStore, Telegram, Calendar, persist
  routes/sessions.ts    # Session status, confirm/refuse, SSE, cancel
  progress/             # SSE progress bus
  internal/             # Token broker for OpenClaw (optional)
skills/                 # Domain prompts (commercial, tech, …)
.bin/                   # MCP list scripts, smoke probes
```

## License

ISC (see `package.json`).
