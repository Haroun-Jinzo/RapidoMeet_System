# openclaw-server — start here

Express backend for RapidoMeet (transcription, extraction, MCP dispatch, OAuth).

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

- API: http://localhost:3000  
- Health: http://localhost:3000/health  
- Frontend (sibling repo): http://localhost:8080  

Fill at least: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` (or OpenAI), `CORS_ORIGIN`, `FRONTEND_URL`.

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Nodemon + ts-node |
| `npm run build` / `npm start` | Compile and run `dist/` |
| `npm run test:api` | Health (+ optional upload) smoke |
| `npm test` | Live pipeline probe (`MeetingTest.mp3` at repo root) |
| `npm run list-cms-tools` | Refresh CMS MCP tool map |
| `npm run list-crm-tools` | List CRM MCP tools |
| `npm run list-rh-tools` | Refresh RH MCP tool map (needs RH `/mcp`) |

## Docs map

| Doc | Content |
|-----|---------|
| [README.md](./README.md) | Project overview |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Pipeline, MCP, auth, **code map** |
| [TESTING.md](./TESTING.md) | Smoke scripts and requirements |
| `.env.example` | All env vars |

Older notes (`DEMO.md`, emoji-heavy checklists) may be outdated; prefer README + ARCHITECTURE + this file.
