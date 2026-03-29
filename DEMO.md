# Quick Start — Test & Demo Guide

## 🚀 Get Running in 3 Minutes

### 1. Setup (One-time only)
```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env and add your API keys:
# GROQ_API_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, etc.
```

### 2. Start Server
```bash
npm run dev
# Waits for connections on http://localhost:3000
```

### 3. Run Test (in another terminal)
```bash
npm run test:sample
```

That's it! You'll see:
- ✅ Transcription result
- ✅ Extracted tasks and decisions  
- ✅ Generated actions
- ✅ Telegram notification sent

---

## 📋 What Gets Tested

The single `/upload-meeting` endpoint tests the **entire pipeline**:

```
Audio File (WAV/MP3)
       ↓
[Transcriber] — Groq Whisper API
       ↓
    Transcript
       ↓
[Skill Loader] — Detects meeting type
       ↓
[Task Extractor] — Gemini NLP API
       ↓
    Extraction: { tasks, decisions, actionItems }
       ↓
[Intent Router] — Decides what to do
       ↓
    Actions: [{ tool, action, params }, ...]
       ↓
[MCP Dispatcher] — Execute actions
       ↓
    Results: [{ tool, success, output }, ...]
       ↓
[Formatter] — Generate human-readable report
       ↓
[Notifier] — Send Telegram/Discord/Email
       ↓
    Done!
```

---

## 🔍 Verify Each Component

### Check Transcription
```bash
# Look for in logs:
# [Transcriber] Starting transcription
# [Transcriber] Complete
# If errors: Check GROQ_API_KEY in .env
```

### Check Extraction
```bash
# Response should contain:
# "extraction": {
#   "tasks": [...],
#   "decisions": [...],
#   "actionItems": [...]
# }
# If empty: Check GEMINI_API_KEY
```

### Check Actions
```bash
# Response should contain:
# "actions": [
#   { "tool": "jira", "action": "create_issue", ... },
#   { "tool": "google_docs", "action": "append", ... }
# ]
```

### Check Notifications
```bash
# Should appear in your Telegram chat
# If not sent: Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Server not running" | Run `npm run dev` in another terminal |
| "GROQ_API_KEY not set" | Add to .env and restart server |
| "Circuit breaker open" | Groq API is overloaded, wait 60s and retry |
| "No telegram notification" | Check bot token and chat ID are valid |
| "Empty extraction" | Transcript too short, use real audio file |

---

## 📁 Test Files

After running `npm run test:sample`, check:

- `test-data/sample.wav` — Generated test audio
- `test-data/result-*.json` — Full API response
- Terminal logs — Detailed step-by-step output

---

## 🎬 Demo Tips

**Before your presentation:**

1. ✅ Run `npm run dev` (leave running)
2. ✅ In new terminal: `npm run test:sample`
3. ✅ Verify Telegram message received
4. ✅ Show logs showing all 7 pipeline steps
5. ✅ Show response JSON with extracted tasks

**For live demo:**
- Use a **real meeting recording** instead of silence for better results
- Place audio file in `test-data/` and mention the path in your slides
- Show the Telegram notification coming in in real-time
- Highlight the structured JSON showing extracted tasks/decisions

---

## 📚 Full Documentation

See [TESTING.md](./TESTING.md) for:
- Detailed testing methods
- Component-by-component verification
- API request/response examples
- Advanced troubleshooting
- Performance tips

---

## ✨ Next Steps

After demo:
- [ ] Deploy to production (see Dockerfile)
- [ ] Add real speaker diarization (pyannote.audio)
- [ ] Implement streaming transcription (AssemblyAI)
- [ ] Add more notification channels (Discord, Slack, email)
- [ ] Scale with Redis caching

