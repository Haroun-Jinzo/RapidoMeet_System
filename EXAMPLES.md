# API Examples — Request & Response

## Example 1: Tech Meeting

### Request
```bash
curl -X POST http://localhost:3000/upload-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==",
    "audio_type": "audio/wav",
    "meeting_title": "Sprint Planning Q1 2026",
    "meeting_type": "tech",
    "language": "fr",
    "participants": "Alice (Dev Lead),Bob (Backend),Charlie (QA)"
  }'
```

### Response
```json
{
  "status": "success",
  "session_id": "sess_1740538400123_abc123",
  "meeting_title": "Sprint Planning Q1 2026",
  "meeting_type": "tech",
  
  "transcript": "Bonjour, aujourd'hui nous discutons du sprint planning pour Q1. Alice dit qu'il faut fixer les bugs de connexion. Bob propose de migrer vers TypeScript. Charlie vérifiera les tests d'intégration...",
  
  "extraction": {
    "tasks": [
      {
        "title": "Fix login authentication bug",
        "assignee": "Bob",
        "deadline": "2026-04-05",
        "priority": "high",
        "description": "Session timeout issue on production"
      },
      {
        "title": "Migrate codebase to TypeScript",
        "assignee": "Alice",
        "deadline": "2026-04-20",
        "priority": "medium",
        "description": "Improve type safety and developer experience"
      },
      {
        "title": "Run full integration test suite",
        "assignee": "Charlie",
        "deadline": "2026-04-10",
        "priority": "high",
        "description": "Verify all new features before release"
      }
    ],
    "decisions": [
      {
        "decision": "Use TypeScript for all new code",
        "impact": "2-week migration effort",
        "owner": "Alice",
        "confidence": 0.95
      },
      {
        "decision": "Defer OAuth integration to Q2",
        "reason": "Resource constraints this quarter",
        "owner": "Bob"
      }
    ],
    "actionItems": [
      {
        "action": "Send TypeScript setup guide to team",
        "owner": "Alice",
        "due": "2026-03-28"
      }
    ]
  },
  
  "actions": [
    {
      "tool": "jira",
      "action": "create_issue",
      "priority": "high",
      "params": {
        "project": "PROJ",
        "summary": "Fix login authentication bug",
        "assignee": "Bob",
        "dueDate": "2026-04-05",
        "description": "Session timeout issue on production"
      }
    },
    {
      "tool": "jira",
      "action": "create_issue",
      "priority": "medium",
      "params": {
        "project": "PROJ",
        "summary": "Migrate codebase to TypeScript",
        "assignee": "Alice",
        "dueDate": "2026-04-20"
      }
    },
    {
      "tool": "google_docs",
      "action": "append_summary",
      "params": {
        "doc_id": "shared-meeting-notes",
        "content": "### Sprint Planning - Q1 2026\n\n**Decisions:**\n- TypeScript migration approved\n- OAuth deferred to Q2\n\n**Tasks:**\n- Fix login bug (Bob, due 2026-04-05)\n- TypeScript migration (Alice, due 2026-04-20)"
      }
    },
    {
      "tool": "email",
      "action": "send_summary",
      "params": {
        "recipients": ["Alice", "Bob", "Charlie"],
        "subject": "Sprint Planning Summary - Q1 2026",
        "template": "meeting_summary"
      }
    }
  ],
  
  "results": [
    {
      "tool": "jira",
      "status": "success",
      "output": "Created issue PROJ-1234: Fix login authentication bug"
    },
    {
      "tool": "jira",
      "status": "success",
      "output": "Created issue PROJ-1235: Migrate codebase to TypeScript"
    },
    {
      "tool": "google_docs",
      "status": "success",
      "output": "Appended summary to document (1547 chars)"
    },
    {
      "tool": "email",
      "status": "success",
      "output": "Sent to 3 recipients"
    }
  ],
  
  "report": "📋 **Sprint Planning - Q1 2026** [2026-03-27]\n\n✅ **3 Tasks Extracted**\n- Fix login authentication bug (Bob, due 2026-04-05)\n- Migrate codebase to TypeScript (Alice, due 2026-04-20)\n- Run full integration test suite (Charlie, due 2026-04-10)\n\n⚠️ **2 Decisions**\n- Use TypeScript for all new code\n- Defer OAuth integration to Q2\n\n🎯 **1 Action Items**\n- Send TypeScript setup guide to team (Alice, due 2026-03-28)\n\n**Links:**\n- Jira: PROJ-1234, PROJ-1235\n- Google Docs: shared-meeting-notes\n\n**Participants:** Alice, Bob, Charlie",
  
  "notifications_sent": ["telegram"],
  
  "metadata": {
    "duration": 284,
    "processing_time_ms": 12453,
    "services_used": ["groq", "gemini", "jira", "google_docs", "email", "telegram"],
    "language_detected": "fr"
  }
}
```

---

## Example 2: Retrospective Meeting

### Request
```bash
curl -X POST http://localhost:3000/upload-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "[base64-encoded audio]",
    "audio_type": "audio/wav",
    "meeting_title": "Sprint 12 Retrospective",
    "meeting_type": "retro",
    "language": "fr",
    "participants": "Team A"
  }'
```

### Response
```json
{
  "status": "success",
  "session_id": "sess_1740538500123_def456",
  "meeting_type": "retro",
  
  "extraction": {
    "tasks": [],
    "decisions": [],
    "actionItems": [
      {
        "action": "Improve code review process",
        "owner": "Team",
        "due": "2026-04-03"
      },
      {
        "action": "Add monitoring alerts for database lag",
        "owner": "Ops",
        "due": "2026-03-30"
      }
    ],
    "retrospective_items": {
      "went_well": [
        "Faster deployment pipeline",
        "Better communication with stakeholders"
      ],
      "could_improve": [
        "Code review turnaround time",
        "Database performance monitoring"
      ],
      "action_items": [
        "Increase code review SLA to 24h",
        "Set up database alerting"
      ]
    }
  },
  
  "actions": [
    {
      "tool": "confluence",
      "action": "create_retrospective_doc",
      "params": {
        "title": "Sprint 12 Retrospective",
        "went_well": ["Faster deployment pipeline", "Better communication"],
        "could_improve": ["Code review turnaround", "Database monitoring"],
        "action_items": [...]
      }
    }
  ],
  
  "report": "📊 **Sprint 12 Retrospective** [2026-03-27]\n\n✅ **Went Well**\n- Faster deployment pipeline (+15% faster)\n- Better stakeholder communication\n\n⚠️ **Could Improve**\n- Code review turnaround time (avg 48h → target 24h)\n- Database performance monitoring\n\n🎯 **Action Items for Next Sprint**\n- Implement 24h code review SLA\n- Set up database lag alerts\n\n**Retrospective:** Confluence\n\n**Team:** Team A",
  
  "notifications_sent": ["telegram"]
}
```

---

## Example 3: Onboarding Meeting

### Request
```bash
curl -X POST http://localhost:3000/upload-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "audio": "[base64-encoded audio]",
    "audio_type": "audio/wav",
    "meeting_title": "Onboarding: New Developer",
    "meeting_type": "onboarding",
    "language": "fr",
    "participants": "HR,Manager,NewEmployee"
  }'
```

### Response
```json
{
  "status": "success",
  "meeting_type": "onboarding",
  
  "extraction": {
    "onboarding_items": {
      "documents_to_complete": [
        "Employment contract",
        "NDA",
        "Tax forms"
      ],
      "equipment_needed": [
        "Laptop (MacBook Pro 16)",
        "Monitor x2",
        "Keyboard & Mouse"
      ],
      "training_required": [
        "Company culture & values",
        "Git workflow & code review process",
        "Security policy"
      ],
      "first_day_tasks": [
        "Meet the team",
        "Access to repositories",
        "Email & communication tools setup"
      ]
    }
  },
  
  "actions": [
    {
      "tool": "monday",
      "action": "create_onboarding_board",
      "params": {
        "name": "Onboarding: New Developer",
        "tasks": ["Equipment request", "Document completion", "Training modules", "First day checklist"]
      }
    }
  ],
  
  "report": "👋 **Onboarding: New Developer** [2026-03-27]\n\n📋 **Documents to Complete**\n- Employment contract\n- NDA\n- Tax forms\n\n🖥️ **Equipment Needed**\n- Laptop (MacBook Pro 16)\n- Monitor x2\n- Keyboard & Mouse\n\n🎓 **Training Required**\n- Company culture & values\n- Git workflow & code review process\n- Security policy\n\n✅ **First Day Checklist**\n- Meet the team\n- Access to repositories\n- Email & communication setup\n\n**Board:** Monday.com - Onboarding Dashboard",
  
  "notifications_sent": ["telegram"]
}
```

---

## Error Responses

### Missing Audio
```json
{
  "status": "error",
  "error": "No audio file provided",
  "code": "MISSING_AUDIO"
}
```

### Unsupported Meeting Type
```json
{
  "status": "error",
  "error": "Unknown meeting type: 'invalid_type'. Use: tech, commercial, onboarding, retro, general",
  "code": "INVALID_MEETING_TYPE"
}
```

### API Configuration Error
```json
{
  "status": "error",
  "error": "[Transcriber] GROQ_API_KEY is not set in environment variables",
  "code": "MISSING_API_KEY"
}
```

### Circuit Breaker Activated
```json
{
  "status": "error",
  "error": "Groq API temporarily unavailable - circuit breaker is OPEN. Please try again in 60 seconds.",
  "code": "CIRCUIT_BREAKER_OPEN"
}
```

---

## Testing with Different Languages

The same endpoint works for multiple languages:

```bash
# French
"language": "fr"

# English
"language": "en"

# Spanish
"language": "es"

# German
"language": "de"
```

Groq Whisper supports 99 languages. Check the [language codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes).

