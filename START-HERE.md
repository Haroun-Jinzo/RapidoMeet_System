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

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Nodemon + ts-node |
| `npm run build` / `npm start` | Compile and run `dist/` |
| `npm run test:api` | Health (+ optional upload) smoke |
| `npm test` | Live pipeline probe (`MeetingTest.mp3` at repo root) |

See [TESTING.md](./TESTING.md) for honest details on what “tests” actually do.

## Docs map

- [TESTING.md](./TESTING.md) — smoke scripts and requirements  
- [ARCHITECTURE.md](./ARCHITECTURE.md) — design overview  
- `.env.example` — all env vars  

Older demo notes (`DEMO.md`, emoji-heavy checklists) may be outdated; prefer this file + `TESTING.md`.
