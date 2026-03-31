# Architecture & Pipeline Visual

## ??? System Architecture

1. **Client Application** sends audio + metadata to **RapidoMeet Express Server**.
2. **RapidoMeet** processes audio via Groq (Transcription) -> Gemini (Extraction/Routing).
3. If tasks require confirmation, the session enters \waiting_confirmation\, the frontend prompts the user, and actions are confirmed by calling \POST /sessions/:id/actions/:actionId/confirm\.
4. Once ready, **RapidoMeet** sends a websocket message to the **OpenClaw Orchestrator**.
5. **OpenClaw** processes and executes workflows (Slack, Notion, Calendar).
6. When OpenClaw needs internal credentials (e.g. Google Access Token), it invokes RapidoMeet internal endpoints (like \/internal/google/access-token\) using an internal shared secret.

### Diagram

\\\mermaid
sequenceDiagram
    participant User
    participant Express as RapidoMeet Express Server
    participant Supabase as Supabase (Vault / DB)
    participant OpenClaw as OpenClaw (AWS Orchestrator)
    
    User->>Express: POST /upload-meeting (JWT Auth)
    Express->>Express: Transcribe (Groq) & Extract (Gemini)
    Express->Supabase: Save Session State
    
    alt Needs Confirmation
        Express-->>User: returns { status: 'awaiting_confirmation' }
        Express->>OpenClaw: WS message 'meeting.awaiting_confirmation'
        User->>Express: POST /sessions/:id/actions/:id/confirm
        Express->>OpenClaw: WS message 'meeting.action_confirmed'
    else Auto-Execute
        Express-->>User: returns { status: 'complete' }
    end
    
    Express->>OpenClaw: WS message 'meeting.completed' (Consolidated Report)
    
    note over OpenClaw: OpenClaw execution phase
    OpenClaw->>Express: POST /internal/google/access-token
    Express->>Supabase: Fetch refresh_token from Vault
    Express-->>OpenClaw: Google access_token
    OpenClaw->>Google: create calendar event
    OpenClaw->>User: Notify via Telegram
\\\

## ??? Security Boundaries
- **Auth**: Frontend passes a real Supabase JWT. Express verifies this via \jsonwebtoken\ + \SUPABASE_JWT_SECRET\.
- **Connections Store**: The Express server uses the \SUPABASE_SERVICE_ROLE_KEY\ to fetch encrypted tokens from Supabase Vault or metadata. These secrets are NEVER logged or exposed to the public API.
- **OpenClaw Internal Endpoints**: OpenClaw fetches minted proxies (e.g., short lived Access tokens, Telegram Proxies) via Express the \/internal/*\ routes, protected by \INTERNAL_OPENCLAW_SECRET\.
- **OpenClaw WS**: Express connects to OpenClaw Websocket server using \OPENCLAW_WS_TOKEN\.

## ?? Key Files
- \src/index.ts\: Entry point, defines main endpoints (\/upload-meeting\, \/sessions/:id\, confirmations).
- \src/openclaw/OpenClawClient.ts\: The dedicated WS client managing connection to BraindCode AWS.
- \src/internal/tokenBroker.ts\: API for OpenClaw to safely resolve user secrets.
- \src/integrations/ConnectionsStore.ts\: Service wrapper resolving OAuth states via Supabase.
- \src/middleware/auth.ts\: JWT Validation.
- \src/config/services.ts\: Defines whether tools are critical or non-critical.
