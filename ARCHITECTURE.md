# Architecture & Pipeline Visual

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLIENT APPLICATION                         │
│                    (Web/Mobile/Desktop)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /upload-meeting
                             │ { audio, title, type, language }
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EXPRESS SERVER (index.ts)                      │
│  Middleware: auth, cors, audio parsing, session creation        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  REQUEST BODY   │
                    │   (Audio File)  │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
      ┌──────────┐   ┌──────────────┐   ┌─────────────┐
      │Transcriber    │SkillRegistry  │ Skill Files │
      │(Groq)     │   │(Auto-detect)  │ (MD files)  │
      └──────────┘   └──────────────┘ └─────────────┘
            │         Detects: tech,
            │         commercial,
            │         onboarding,
            │         retro, general
            │
      ┌─────▼──────────────────────────────┐
      │   TRANSCRIPT + SKILL CONTENT       │
      │   "nous avons décidé de..."        │
      │   + tech.md (extraction rules)     │
      └─────┬──────────────────────────────┘
            │
            ▼
      ┌──────────────────┐
      │ TaskExtractor    │
      │ (Gemini API)     │
      │                  │
      │ Extracts:        │
      │ - Tasks          │
      │ - Decisions      │
      │ - Action Items   │
      └─────┬────────────┘
            │
      ┌─────▼──────────────────────────┐
      │ EXTRACTION RESULT              │
      │ {                              │
      │   tasks: [...],                │
      │   decisions: [...],            │
      │   actionItems: [...]           │
      │ }                              │
      └─────┬──────────────────────────┘
            │
            ▼
      ┌──────────────┐
      │ IntentRouter │
      │ (Decides)    │
      │              │
      │ Match to:    │
      │ - Jira       │
      │ - Google     │
      │ - Gmail      │
      │ - n8n, etc   │
      └─────┬────────┘
            │
      ┌─────▼──────────────────────────┐
      │ ACTIONS                        │
      │ [                              │
      │  { tool: jira, action: ... }, │
      │  { tool: gmail, action: ... }  │
      │ ]                              │
      └─────┬──────────────────────────┘
            │
            ▼
      ┌────────────────┐
      │ MCPDispatcher  │
      │ (Execute)      │
      │                │
      │ Uses: OpenClaw │
      │ MCP Server     │
      └─────┬──────────┘
            │
      ┌─────▼──────────────────────────┐
      │ RESULTS                        │
      │ [                              │
      │  { tool: jira, success: ... }, │
      │  { tool: gmail, success: ... } │
      │ ]                              │
      └─────┬──────────────────────────┘
            │
      ┌─────┴───────┐
      ▼             ▼
   ┌─────────┐  ┌──────────┐
   │Formatter │  │Notifier  │
   │          │  │          │
   └─────┬────┘  └─────┬────┘
         │             │
    ┌────▼────────┐    ├─→ Telegram
    │REPORT       │    ├─→ Discord
    │             │    ├─→ Email
    │Formatted    │    └─→ Slack
    │Summary      │
    └────┬────────┘
         │
    ┌────▼─────────────────────────┐
    │ RESPONSE TO CLIENT            │
    │ {                             │
    │   status: "success",          │
    │   transcript,                 │
    │   extraction,                 │
    │   actions,                    │
    │   results,                    │
    │   report,                     │
    │   notifications_sent          │
    │ }                             │
    └───────────────────────────────┘
```

## 📦 Module Dependencies

```
Client
  ↓
index.ts (Express server)
  ├── transcribe.ts (Groq API)
  ├── skill-loader.ts (File system)
  ├── extract.ts (Gemini API)
  ├── router.ts (Logic)
  ├── dispatcher.ts (OpenClaw MCP)
  ├── formatter.ts (Templates)
  ├── notifier.ts (Telegram, Discord, Email)
  ├── memory.ts (PostgreSQL)
  ├── session.ts (Session management)
  └── resilience/CircuitBreaker.ts (Reliability)
```

## 🔄 Data Flow Through Pipeline

### 1️⃣ Audio Input
```
User uploads: 30-second Zoom recording (French)
              ├── Format: MP3/WAV/M4A
              ├── Size: 50MB max
              └── Language: auto-detect or specified
```

### 2️⃣ Transcription
```
Input:  Audio buffer + language code
         ↓ [Groq Whisper API]
Output: {
  transcript: "Bonjour, aujourd'hui nous parlons de...",
  segments: [...],  // With timestamps
  duration: 284,    // Seconds
  confidence: 0.95
}
```

### 3️⃣ Skill Detection
```
Input:  Transcript: "Nous avons décidé de migrer vers TypeScript"
         ↓ [Keyword matching + ML hints]
Output: Skill type = "tech"
        Load: src/skills/tech.md
```

### 4️⃣ NLP Extraction
```
Input:  Transcript + tech.md extraction rules
         ↓ [Gemini API with prompt engineering]
Output: {
  tasks: [
    { title: "Migrate to TypeScript", assignee: "Alice", deadline: "2026-04-20" },
    ...
  ],
  decisions: [
    { decision: "Use TypeScript", owner: "Bob", impact: "2-week effort" }
  ]
}
```

### 5️⃣ Intent Routing
```
Input:  Extracted tasks + meeting type (tech)
         ↓ [Rules-based routing]
Output: Actions = [
  { tool: "jira", action: "create_issue", params: {...} },
  { tool: "google_docs", action: "append_summary", params: {...} },
  { tool: "email", action: "send", params: {...} }
]
```

### 6️⃣ Dispatch & Execute
```
Input:  Actions array
         ↓ [OpenClaw MCP Server with circuit breaker]
Output: Results = [
  { tool: "jira", success: true, output: "Issue PROJ-1234 created" },
  { tool: "google_docs", success: true, output: "Document updated" },
  { tool: "email", success: true, output: "Sent to 3 recipients" }
]
```

### 7️⃣ Report & Notify
```
Input:  All previous outputs
         ↓ [Template-based formatting]
Output: {
  report_text: "📋 **Meeting: Tech Planning**\n\n✅ 2 tasks extracted\n...",
  notifications: ["telegram", "email"]
}

Telegram: "📋 Tech Planning Summary\n✅ 2 tasks created\n⚡ Actions dispatched"
Email:    [formatted HTML email]
```

## 🎯 Meeting Type Specialization

```
Meeting Type    | Skill File        | Key Extractions
─────────────────────────────────────────────────────
tech            | tech.md           | Tasks, bugs, technical decisions
commercial      | commercial.md     | Deals, revenue targets, partnerships
onboarding      | onboarding.md     | Equipment, training, documents
retro           | retro.md          | What went well, improvements, action items
general         | general.md        | Safe default extraction
```

## 🛡️ Reliability Features

```
┌─────────────────────────┐
│  Circuit Breaker        │
│  (for Groq + Toolkit)   │
│                         │
│  Protects Against:      │
│  ✓ API timeouts        │
│  ✓ Rate limiting       │
│  ✓ Cascading failures  │
│  ✓ Retry storms        │
└─────────────────────────┘
      │
      ├─→ Auto-reset after 60s
      ├─→ Fast-fail with clear errors
      └─→ Prevents system overload
```

## 📊 Processing Timeline

For a typical 5-minute meeting:

```
Audio Upload:          0-3s
  ├─ File validation: ~100ms
  ├─ Groq Whisper: ~2-3s (depends on audio length)
  └─ Transcription cleanup: ~50ms

Skill Detection:       50-200ms
  └─ Pattern matching on transcript

NLP Extraction:        1-2s
  └─ Gemini API call (streaming)

Intent Routing:        100-300ms
  └─ Rule matching + action generation

Action Dispatch:       500-2000ms
  ├─ Jira: 300-500ms per issue
  ├─ Google Docs: 200-400ms
  ├─ Email: 100-200ms
  └─ n8n webhooks: 200-500ms

Report & Notify:       500-1000ms
  ├─ Format: 50-100ms
  └─ Send Telegram/Email: 400-900ms

─────────────────────────────
TOTAL:                 3-7 seconds
```

## 🗄️ Database Schema (PostgreSQL)

```
sessions
├── id (uuid)
├── user_id
├── meeting_title
├── meeting_type
├── transcript
├── extraction (jsonb)
├── actions (jsonb)
├── results (jsonb)
├── created_at

redis (caching)
├── transcript_cache:{session_id}
├── extraction_cache:{session_id}
└── skill_cache (loaded on startup)
```

## 🚀 Scaling Considerations

```
Current:  Single server, sync processing
        ├─ Good for: <100 meetings/day
        └─ Max latency: ~7s per meeting

Scale 1:  Add Redis queue
        ├─ Async task processing
        ├─ Good for: 100-1000 meetings/day
        └─ Max latency: ~100ms (user-facing)

Scale 2:  Distributed workers
        ├─ Transcription service (separate)
        ├─ Extraction service (separate)
        ├─ Action dispatch service (separate)
        ├─ Good for: 1000+ meetings/day
        └─ May need: Kafka, microservices
```

---

This architecture is designed to be:
- **Reliable** — Circuit breakers, error handling, retry logic
- **Extensible** — New models (skills) in `src/skills/`
- **Observable** — Detailed logging at each step
- **Testable** — Each component can be tested independently

