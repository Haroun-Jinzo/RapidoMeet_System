# 📚 Complete Testing & Demo Documentation Index

Your OpenClaw Server is now fully documented and ready for testing!

## 🎯 Quick Navigation

**Starting out?** → Read in this order:

1. **[DEMO.md](./DEMO.md)** ⭐ **START HERE**
   - 3-minute quickstart guide
   - Essential commands to run
   - Demo tips and tricks
   - **Time to first test: 3 minutes**

2. **[README-TESTING.md](./README-TESTING.md)** 
   - Overview of what was created
   - File organization
   - Complete checklist before demo
   - Next steps

3. **[TESTING.md](./TESTING.md)**
   - Comprehensive testing guide
   - All testing methods (script, curl, manual)
   - What gets tested (all 7 pipeline steps)
   - Detailed troubleshooting

---

## 📖 Reference Documents

**Need specific information?** Use these references:

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System design, data flow, pipeline visualization
- **[EXAMPLES.md](./EXAMPLES.md)** — Real request/response examples for each meeting type
- **[package.json](./package.json)** — NPM scripts (test, dev, build, start)

---

## 🚀 Run Your First Test (Right Now!)

```bash
# Terminal 1 — Start server
npm run dev

# Terminal 2 — Run test (in new terminal)
npm run test:sample
```

**Expected output:** Full pipeline execution, Telegram notification, response JSON  
**Time:** ~5-10 seconds  
**Success:** See "✅ Test completed!" message

---

## 🧪 Available Test Methods

| Method | Platform | Command | Time |
|--------|----------|---------|------|
| **Node.js** (Recommended) | Windows/Mac/Linux | `npm run test:sample` | 5-10s |
| **PowerShell** | Windows only | `.\_test-api.ps1` | 10-15s |
| **Bash** | Mac/Linux only | `./test-api.sh` | 10-15s |
| **curl** (Manual) | All platforms | See TESTING.md | 5-10s |
| **Your own recording** | All platforms | Place in test-data/ | varies |

---

## ✅ Verification Checklist

Before your demonstration, verify:

- [ ] **Dependencies installed**
  ```bash
  npm install
  ```

- [ ] **Environment configured**
  ```bash
  cp .env.example .env
  # Edit .env with API keys
  ```

- [ ] **Server starts**
  ```bash
  npm run dev
  # Should see "listening on port 3000"
  ```

- [ ] **Test passes**
  ```bash
  npm run test:sample
  # Should see "✅ Test completed!"
  ```

- [ ] **All components verified**
  - ✅ Transcription (check logs for [Transcriber])
  - ✅ Skill detection (check logs for [SkillRegistry])
  - ✅ Extraction (check response.extraction)
  - ✅ Routing (check response.actions)
  - ✅ Dispatch (check response.results)
  - ✅ Report (check response.report)
  - ✅ Notification (check Telegram chat)

- [ ] **No errors in logs**
  - No ERROR messages
  - No WARN messages with failed services

---

## 📊 What Gets Tested

Each test executes your **complete system**:

```
Audio (uploaded)
   ↓
Groq Whisper (transcription) — env: GROQ_API_KEY
   ↓
Auto-detect meeting type (tech, commercial, onboarding, retro, general)
   ↓
Load skill file (src/skills/*.md)
   ↓
Gemini API (NLP extraction) — env: GEMINI_API_KEY
   ↓
Intent router (decide actions)
   ↓
OpenClaw MCP (execute tasks)
   ↓
Report formatter (create summary)
   ↓
Telegram notifier (send message) — env: TELEGRAM_BOT_TOKEN
   ↓
Done! (response sent to client)
```

---

## 🎬 Demo Script (5 Minutes)

When showing to stakeholders:

**30 seconds — Setup:**
```bash
# Show server is running
npm run dev
# Let it print startup messages
```

**2 minutes — Run test:**
```bash
# In new terminal
npm run test:sample
# Show progress messages as it runs
```

**1.5 minutes — Show results:**
```bash
# Point out in terminal:
1. Transcript of meeting (French text)
2. Extracted tasks (array with titles, assignees, deadlines)
3. Actions generated (Jira issue created, etc.)
4. Telegram notification received
```

**1 minute — Discuss:**
- "The system understood French speech"
- "It automatically detected this was a tech meeting"
- "It extracted 2 tasks and 1 decision in 5 seconds"
- "It created a Jira ticket automatically"
- "It sent a Telegram summary notification"
- "This all happens in real-time from a single audio file"

---

## 🔍 Monitor Individual Components

Watch the logs to see each component in action:

```
[Transcriber] Starting transcription...
  ↓ [Wait ~2-3 seconds]
[Transcriber] Complete — duration: 285s, segments: 42, elapsed: 2451ms
  ✅ Transcription done

[SkillRegistry] Detected meeting type: tech
  ✅ Skill loaded

[TaskExtractor] Extracting with skill: tech.md
  ↓ [Wait ~1-2 seconds]
[TaskExtractor] Extraction complete — 2 tasks, 1 decision
  ✅ Extraction done

[Router] Generated 4 actions
  ✅ Routing done

[MCP Dispatcher] Executing 4 actions...
[MCP Dispatcher] Jira: create_issue — success
[MCP Dispatcher] Google Docs: append — success
[MCP Dispatcher] Email: send — success
  ✅ All actions executed

[Formatter] Generated report (1247 chars)
  ✅ Report created

[Notifier] Sending via telegram...
[Notifier] Notification sent successfully
  ✅ Notification sent

Status: SUCCESS ✅
```

---

## 🐛 Troubleshooting

**"Server won't start"**
```bash
# Check for port conflicts
netstat -ano | findstr :3000  # Windows
lsof -i :3000                # Mac/Linux
```

**"GROQ_API_KEY not set"**
```bash
# 1. Check .env file exists
# 2. Has GROQ_API_KEY=...
# 3. Restart npm run dev
```

**"Circuit breaker open"**
```bash
# Groq API is overloaded
# Wait 60 seconds and try again
# Or check internet connection
```

**"No Telegram notification"**
```bash
# Check .env has:
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...
# Bot must have permission to send messages
```

See [TESTING.md](./TESTING.md) for detailed troubleshooting.

---

## 📁 Project Structure

```
openclaw-server/
├── 📚 DEMO.md                      ← START HERE!
├── 📚 TESTING.md                   ← Full testing guide
├── 📚 EXAMPLES.md                  ← Example requests/responses
├── 📚 ARCHITECTURE.md              ← System design
├── 📚 README-TESTING.md            ← This document
├── 📄 package.json                 ← npm scripts
├── src/
│   ├── index.ts                    ← Express server + pipeline orchestration
│   ├── transcribe.ts               ← Groq Whisper (audio → text)
│   ├── extract.ts                  ← Gemini NLP (text → tasks)
│   ├── router.ts                   ← Intent routing (tasks → actions)
│   ├── dispatcher.ts               ← MCP execution (actions → results)
│   ├── formatter.ts                ← Report generation
│   ├── notifier.ts                 ← Telegram/Discord/Email
│   ├── skill-loader.ts             ← Load meeting-type skills
│   ├── skills/
│   │   ├── tech.md                 ← Tech meeting rules
│   │   ├── commercial.md           ← Commercial meeting rules
│   │   ├── onboarding.md           ← Onboarding rules
│   │   ├── retro.md                ← Retrospective rules
│   │   └── general.md              ← Default rules
│   └── ...
├── .bin/
│   └── test-sample.js              ← Test runner (npm run test:sample)
├── test-api.ps1                    ← PowerShell test script
├── test-api.sh                     ← Bash test script
└── test-data/
    └── sample.wav                  ← Generated test audio (auto-created)
```

---

## 🎓 Learning Resources

**Want to understand how each component works?**

1. **[src/transcribe.ts](./src/transcribe.ts)** — Groq Whisper integration
2. **[src/extract.ts](./src/extract.ts)** — Gemini NLP extraction
3. **[src/router.ts](./src/router.ts)** — Intent routing logic
4. **[src/dispatcher.ts](./src/dispatcher.ts)** — MCP action execution
5. **[src/skill-loader.ts](./src/skill-loader.ts)** — Skill loading and detection

Each file has detailed comments explaining the flow.

---

## 📞 Support

If something doesn't work:

1. **Check logs** — Each component logs what it's doing
2. **Review [TESTING.md](./TESTING.md)** — Detailed troubleshooting section
3. **Check [EXAMPLES.md](./EXAMPLES.md)** — Compare your response to expected format
4. **Verify .env** — All API keys present and valid

---

## ✨ What's Next?

After successful testing:

- [ ] **Show stakeholders** — Run demo with real meeting recording
- [ ] **Deploy** — Use Dockerfile for production
- [ ] **Add monitoring** — Log to external service
- [ ] **Scale** — Add Redis queue for high volume
- [ ] **Enhance** — Add speaker diarization (pyannote.audio)
- [ ] **Real-time** — Consider streaming transcription (AssemblyAI/Deepgram)

---

## 🎉 You're Ready!

Everything is set up. Your next step:

```bash
npm run dev              # Terminal 1
npm run test:sample     # Terminal 2
```

See [DEMO.md](./DEMO.md) for the complete 3-minute guide.

**Good luck with your demonstration! 🚀**

