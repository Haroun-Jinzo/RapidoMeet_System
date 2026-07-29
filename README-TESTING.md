# Testing overview

Prefer **[TESTING.md](./TESTING.md)** and **[START-HERE.md](./START-HERE.md)**.

Summary:

- There is **no Jest/Vitest unit suite** in this repo today.
- `npm test` = live `/upload-meeting` probe (needs server + `MeetingTest.mp3` + API keys).
- `npm run test:api` = PowerShell health smoke (and optional upload).
- `GET /health` = cheap liveness check for ops.
