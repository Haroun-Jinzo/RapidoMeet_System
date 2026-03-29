# Testing Guide - OpenClaw Server

This guide helps you test the entire pipeline end-to-end before your demonstration.

## Quick Start

### 1. Setup Environment
```bash
# Install dependencies
npm install

# Configure your .env file
cp .env.example .env
# Edit .env with your actual API keys:
# - GROQ_API_KEY (Whisper transcription)
# - GEMINI_API_KEY (NLP extraction)
# - SUPABASE credentials (database)
# - TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID (notifications)
```

### 2. Start the Server
```bash
# Development mode with auto-reload
npm run dev
# Server listens on http://localhost:3000
```

### 3. Test the Pipeline
Use the test scripts below to upload a meeting and see the full pipeline in action.

---

## Testing Methods

### Option A: Quick Test with Sample Audio (RECOMMENDED)
Easiest way to test—uses pre-recorded sample audio.

```bash
# Run the test script
npm run test:sample

# This does:
# 1. Generates a sample audio file
# 2. Uploads to /upload-meeting endpoint
# 3. Shows transcription, extraction, actions, and notifications
```

### Option B: Test with Real Meeting Recording
If you have a recorded meeting file:

```bash
# Put your audio file in ./test-data/
# Then use curl to upload

curl -X POST http://localhost:3000/upload-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "'"$(base64 -w0 test-data/your-meeting.wav)"'",
    "audio_type": "audio/wav",
    "meeting_title": "Q1 Planning Session",
    "meeting_type": "tech",
    "language": "fr",
    "participants": "Alice,Bob,Charlie"
  }'
```

### Option C: Manual Testing with curl (Advanced)
Test individual components:

#### Test Transcription Only
```bash
curl -X POST http://localhost:3000/upload-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "'"$(base64 -w0 sample.wav)"'",
    "audio_type": "audio/wav",
    "meeting_title": "Test Meeting",
    "meeting_type": "general",
    "language": "fr"
  }' | jq '.transcript'
```

---

## What Gets Tested

### 1. **Transcription** (`src/transcribe.ts`)
- ✅ Audio file validation
- ✅ Groq Whisper API call with circuit breaker protection
- ✅ Temp file creation and cleanup
- ✅ Segment building from Whisper response

**Output Check**: Look for `transcript` field in response

### 2. **Skill Detection & Loading** (`src/skill-loader.ts`)
- ✅ Auto-detect meeting type from transcript
- ✅ Load appropriate skill (tech.md, commercial.md, etc.)
- ✅ Fall back to general.md if type not recognized

**Output Check**: Check headers in logs: `[SkillRegistry] Detected meeting type: tech`

### 3. **NLP Extraction** (`src/extract.ts`)
- ✅ Uses Gemini to extract tasks, decisions, and action items
- ✅ Respects skill-specific extraction rules
- ✅ Returns structured JSON

**Output Check**: Look for `extraction` field with `tasks`, `decisions`, `actionItems`

### 4. **Intent Routing** (`src/router.ts`)
- ✅ Decides what actions to take based on extraction
- ✅ Routes to appropriate tools (Jira, Google Docs, email, etc.)
- ✅ Filters actions by meeting type

**Output Check**: Check `actions` field with tool assignments

### 5. **Action Dispatching** (`src/dispatcher.ts`)
- ✅ Executes actions via MCP (Model Context Protocol)
- ✅ Handles errors gracefully
- ✅ Returns execution results

**Output Check**: Look for `results` with success/failure status

### 6. **Report Formatting** (`src/formatter.ts`)
- ✅ Generates human-readable summary
- ✅ Differs by channel (Telegram vs email vs Slack)
- ✅ Includes meeting metadata, extracted items, and action links

**Output Check**: Check formatted report in response body

### 7. **Notifications** (`src/notifier.ts`)
- ✅ Sends Telegram message (if configured)
- ✅ Would send Discord/email (when enabled)
- ✅ Includes formatted report

**Output Check**: Check your Telegram chat for notification

---

## Expected Response Flow

When you POST to `/upload-meeting`, the response shows the entire pipeline:

```json
{
  "status": "success",
  "session_id": "sess_abc123def456",
  "transcript": "Nous avons discuté de trois points...",
  "extraction": {
    "tasks": [
      { "title": "Fix login bug", "assignee": "Bob", "deadline": "2026-04-05" },
      { "title": "Update documentation", "assignee": "Alice", "deadline": "2026-04-10" }
    ],
    "decisions": [
      { "decision": "Migrate to TypeScript", "impact": "2-week effort", "owner": "Charlie" }
    ],
    "actionItems": [ ... ]
  },
  "actions": [
    { "tool": "jira", "action": "create_issue", "params": { ... } },
    { "tool": "google_docs", "action": "append_summary", "params": { ... } }
  ],
  "results": [
    { "tool": "jira", "success": true, "output": "Issue PROJ-123 created" },
    { "tool": "google_docs", "success": true, "output": "Document updated" }
  ],
  "report": "📋 **Réunion: Q1 Planning** [2026-03-27]\n\n✅ 2 tâches extraites\n⚠️ 1 décision\n...",
  "notifications_sent": ["telegram"]
}
```

---

## Troubleshooting Common Issues

### ❌ "GROQ_API_KEY is not set"
- Check `.env` file has `GROQ_API_KEY=gsk_...`
- Server reads `.env` on `npm run dev` start
- Restart server if you edited `.env`

### ❌ "Groq API call timeout / Circuit breaker open"
- Check internet connection
- Verify API key is valid: https://console.groq.com/
- Wait for circuit breaker to reset (default: 60 seconds)
- Check logs for `CircuitBreaker: OPEN`

### ❌ "No audio file provided"
- Ensure request includes `audio` field (base64-encoded)
- Check `audio_type` matches the actual format (`audio/wav`, `audio/mp3`, etc.)

### ❌ "Telegram notification failed"
- Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env`
- Test token: `curl https://api.telegram.org/bot{TOKEN}/getMe`
- Verify chat ID exists and bot has permission to send

### ❌ "Extraction returned empty"
- Check `GEMINI_API_KEY` is valid
- Verify transcript is long enough (Gemini needs context)
- Check logs for `[TaskExtractor]` errors

---

## Demo Checklist

Before your presentation:

- [ ] `.env` is configured with all API keys
- [ ] Run `npm run dev` and server starts without errors
- [ ] Run test script: `npm run test:sample`
- [ ] Check response contains all 7 steps (transcript → extraction → actions → notification)
- [ ] Verify Telegram notification was received
- [ ] Check database (Supabase) has the meeting saved
- [ ] Logs show no ERROR or WARN messages

---

## Files to Monitor During Testing

- **Logs**: Watch terminal for `[Transcriber]`, `[TaskExtractor]`, `[Router]`, etc.
- **Database**: Check Supabase `sessions` and `meetings` tables
- **Notifications**: Check Telegram for incoming messages
- **temp files**: `/tmp/rapidomeet_*.wav` should be cleaned up (not left behind)

---

## Next Steps After Testing

1. **Works locally?** → Deploy to production (see Dockerfile)
2. **Want real-time?** → Consider streaming transcription (AssemblyAI/Deepgram)
3. **Need speaker detection?** → Add pyannote.audio or AssemblyAI speaker diarization
4. **Scale?** → Add Redis caching (see `src/memory.ts`)

