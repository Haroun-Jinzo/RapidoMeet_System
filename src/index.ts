// src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 1: Server Entry Point
// Responsibility: Start Express server, set up routes, manage request pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import express, { Request, Response } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load environment variables from .env file
dotenv.config();

// Import all module instances
import { transcriber } from "./transcribe";
import { taskExtractor } from "./extract";
import { KeyResolver } from "./utils/KeyResolver";
import { intentRouter } from "./router";
import { mcpDispatcher } from "./dispatcher";
import { sessionManager } from "./session";
import { skillRegistry } from "./skill-loader";
import { memoryManager } from "./memory";
import { requireAuth } from "./middleware/auth";
import { internalRouter } from "./internal/tokenBroker";
import { openclawClient } from "./openclaw/OpenClawClient";
import multer from "multer";
import { progressBus } from "./progress/ProgressBus";
import { streamSessionProgress } from "./progress/sse";
import { crmOAuthRouter } from "./auth/crmOAuthRouter";
import { googleOAuthRouter } from "./auth/googleOAuthRouter";
import { telegramRouter } from "./auth/telegramRouter";
import { isCrmTool } from "./config/crmTools";
import { mergeActionStatuses } from "./utils/mergeActionStatuses";
import { formatPendingAction, formatConfirmationAction } from "./utils/pendingActionFormatter";
import { IAction, ISessionContext } from "./interfaces";
import { persistMeetingResults } from "./integrations/persistMeetingResults";

function getPendingCriticalActions(actions: IAction[] | undefined): IAction[] {
  return actions?.filter((a) => a.requiresConfirmation && a.status === "pending") ?? [];
}

async function syncMeetingToSupabase(
  session: ISessionContext,
  meetingStatus: "analyzing" | "completed"
): Promise<void> {
  try {
    await persistMeetingResults(session, { meetingStatus });
  } catch (err) {
    console.warn("[Pipeline] persistMeetingResults failed:", (err as Error).message);
  }
}

type AudioUploadRequest = Omit<Request, "file"> & {
  file?: {
    buffer: Buffer;
    mimetype: string;
  };
};

const upload = multer({ storage: multer.memoryStorage() });

// ── Supabase Setup ────────────────────────────────────────────────────────
// Initialize Supabase client for persistent audio storage

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUDIO_BUCKET = "audio-files";

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Helper: Upload audio to Supabase for persistent storage
async function uploadAudioToSupabase(
  audioBuffer: Buffer,
  sessionId: string,
  mimeType: string
): Promise<string | null> {
  if (!supabase) {
    console.warn("[Storage] Supabase not configured, skipping audio storage");
    return null;
  }

  try {
    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === AUDIO_BUCKET);
    
    if (!bucketExists) {
      console.log(`[Storage] Creating bucket: ${AUDIO_BUCKET}`);
      await supabase.storage.createBucket(AUDIO_BUCKET, {
        public: false,
        allowedMimeTypes: ["audio/*"],
      });
    }

    // Upload file with session ID as name
    const fileName = `${sessionId}.mp3`;
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(fileName, audioBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.warn(`[Storage] Upload failed: ${error.message}`);
      return null;
    }

    console.log(`[Storage] Audio stored: ${data.path}`);
    return data.path;
  } catch (err) {
    console.warn(`[Storage] Error uploading to Supabase:`, (err as Error).message);
    return null;
  }
}

// Auth middleware uses Supabase JWT
const authMiddleware = requireAuth;

// ── Express Setup ──────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// Simple request logger for debugging uploads
app.use((req, res, next) => {
  if (req.path === '/upload-meeting') {
    console.log('[Request] Incoming upload:', req.method, req.path, 'headers:', {
      'x-internal-auth': req.headers['x-internal-auth'],
      'x-internal-user-id': req.headers['x-internal-user-id'],
    });
  }
  next();
});

// Internal routes (OpenClaw -> RapidoMeet via shared secret)
app.use('/internal', internalRouter);

// RapidoCRM OAuth2 + PKCE (public client — no client_secret required)
app.use('/auth/crm', crmOAuthRouter);
app.use('/auth/google', googleOAuthRouter);
app.use('/auth/telegram', telegramRouter);

// Custom file handling - expects audio data in req.body
const handleAudioUpload: express.RequestHandler = (req, res, next) => {
  const request = req as AudioUploadRequest;

  if (request.body.audio && typeof request.body.audio === "string") {
    // If audio is base64-encoded in the body
    request.file = {
      buffer: Buffer.from(request.body.audio, "base64"),
      mimetype: request.body.audio_type || "audio/wav"
    };
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload-meeting
// The main pipeline endpoint that orchestrates the entire meeting processing.
// ─────────────────────────────────────────────────────────────────────────────

app.post(
  "/upload-meeting",
  authMiddleware,
  upload.single("audio"),
  handleAudioUpload,
  async (req: AudioUploadRequest, res: Response) => {
    const user = (req as any).user;

    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const {
      meeting_title = "",
      meeting_type  = "",
      language      = "",
      participants  = "",
      user_instructions = "",
      meeting_id    = "",
      meetingId     = "",
    } = req.body;

    const resolvedMeetingId =
      (typeof meeting_id === "string" && meeting_id.trim()) ||
      (typeof meetingId === "string" && meetingId.trim()) ||
      undefined;

    // ── Step 1: Create session ─────────────────────────────────────────────
    const session = await sessionManager.create(
      user.id,
      meeting_title,
      meeting_type as any
    );

    if (resolvedMeetingId) {
      session.meetingId = resolvedMeetingId;
    }

    // Parse participants from comma-separated string to array
    session.participants = participants
      ? participants.split(",").map((p: string) => p.trim()).filter(Boolean)
      : [];

    await sessionManager.save(session);

    progressBus.emit({
      sessionId: session.id,
      step: "started",
      message: "Meeting upload received — starting processing",
      progress: 0,
      detail: `Session ${session.id}`,
    });

    // Capture file to avoid undefined issues in async closure
    const audioFile = req.file;

    // ─── Return 202 Accepted immediately ─────────────────────────────────
    // The bot runner gets confirmation that the request was accepted.
    console.log(`[Upload] Created session ${session.id} for user ${user.id} - returning 202`);
    res.status(202).json({
      session_id: session.id,
      status: "processing",
      message: "Meeting upload received and is being processed in the background",
    });

    // ─── Process pipeline asynchronously (fire-and-forget) ───────────────
    // This ensures the bot runner won't timeout waiting for heavy operations
    (async () => {
      try {
        // Resolve dynamic API keys based on the user's Supabase vaulted preferences
        const apiKeys = await KeyResolver.resolveKeys(user.id);
        console.log(
          "[Pipeline] Key sources:",
          `orchestrator=${apiKeys.Orchestrator.provider}(len=${apiKeys.Orchestrator.apiKey.length})`,
          `stt=${apiKeys.AudioTranscriber.provider}(len=${apiKeys.AudioTranscriber.apiKey.length})`,
          `n8n=${apiKeys.n8n ? `len=${apiKeys.n8n.length}` : "missing"}`
        );
        
        if (!apiKeys || Object.keys(apiKeys).length === 0) {
          console.warn("[Pipeline] No API keys configured for user:", user.id);
          session.status = "error";
          await sessionManager.save(session);
          progressBus.emit({
            sessionId: session.id,
            step: "error",
            message: "Processing failed — API keys are not configured",
            progress: 0,
            error: "No API keys configured for this user",
          });
          return;
        }

        // ── Step 2: Transcribe ───────────────────────────────────────────────
        console.log(`[Pipeline] ${session.id} — Step 1: Transcription`);
        const transcription = await transcriber.transcribeFile(
          audioFile.buffer,
          audioFile.mimetype,
          language,
          apiKeys
        );
        session.transcript = transcription.transcript;
        session.transcriptionSegments = transcription.segments;
        session.durationSeconds = Math.round(transcription.duration ?? 0);
        await sessionManager.save(session);
        progressBus.emit({
          sessionId: session.id,
          step: "transcription",
          message: "Audio transcribed successfully",
          progress: 25,
          detail: `${transcription.transcript.length} characters, ${Math.round(transcription.duration)}s audio`,
        });

        // ── Step 3: Detect skill + Extract ──────────────────────────────────
        console.log(`[Pipeline] ${session.id} — Step 2: Skill detection`);
        const skill = skillRegistry.get(meeting_type)
          || skillRegistry.detect(transcription.transcript);
        progressBus.emit({
          sessionId: session.id,
          step: "skill_detection",
          message: `Skill detected: ${skill.name}`,
          progress: 35,
          detail: skill.name,
        });

        console.log(`[Pipeline] ${session.id} — Step 3: NLP extraction`);
        const extraction = await taskExtractor.extract(
          transcription.transcript,
          meeting_type as any,
          skill.content,
          apiKeys
        );
        session.extraction = extraction;
        await sessionManager.save(session);
        progressBus.emit({
          sessionId: session.id,
          step: "extraction",
          message: "Meeting content extracted",
          progress: 55,
          detail: `${extraction.tasks.length} tasks, ${extraction.decisions.length} decisions, ${extraction.prospects.length} prospects`,
        });

        // ── Step 4: Route — decide actions ──────────────────────────────────
        console.log(`[Pipeline] ${session.id} — Step 4: Intent routing`);
        const actions = await intentRouter.decide(
          extraction,
          session.id,
          skill.content,
          user_instructions,
          apiKeys
        );
        progressBus.emit({
          sessionId: session.id,
          step: "routing",
          message: `${actions.length} action${actions.length === 1 ? "" : "s"} planned`,
          progress: 65,
          detail: actions.map((a) => a.tool).join(", "),
        });
        // INJECT THE REAL USER ID INTO THE AI'S GENERATED ACTIONS
        actions.forEach(action => {
          action.params.userId = user.id;
          action.params.sessionId = session.id;
        });
        session.actions = actions;
        await sessionManager.save(session);

        // ── Step 5: Execute non-critical actions immediately ───────────────
        console.log(`[Pipeline] ${session.id} — Step 5: Executing Actions via N8N...`);
        await mcpDispatcher.executeAll(actions, session.id, apiKeys, {
          userId: user.id,
        });

        // Persist dispatch state so approvals during slow I/O see up-to-date actions
        session.actions = actions;
        await sessionManager.save(session);

        // Persist extraction output early so meeting tabs populate during approval waits
        await syncMeetingToSupabase(session, "analyzing");

        // Upload audio
        let audioStoragePath: string | null = null;
        try {
          audioStoragePath = await uploadAudioToSupabase(
            audioFile.buffer,
            session.id,
            audioFile.mimetype
          );
        } catch (storageErr) {
          console.warn("[Pipeline] Supabase storage failed (non-fatal):", (storageErr as Error).message);
        }

        // ── Step 6: Check for critical actions delaying completion ─────────
        // Reconcile with Redis — user may have approved while step 5 I/O was running
        const persisted = await sessionManager.load(session.id);
        if (persisted?.actions) {
          mergeActionStatuses(actions, persisted.actions);
        }
        session.actions = actions;

        const pendingCritical = actions.filter(
          (a) => a.requiresConfirmation && a.status === "pending"
        );

        const alreadyComplete =
          persisted?.status === "complete" && pendingCritical.length === 0;

        if (alreadyComplete) {
          session.status = "complete";
          await sessionManager.save(session);
          await syncMeetingToSupabase(session, "completed");
          console.log(`[Pipeline] ${session.id} — Complete (approvals received during step 5)`);
        } else if (pendingCritical.length > 0) {
          session.status = "awaiting_confirmation";
          await sessionManager.save(session);
          await syncMeetingToSupabase(session, "analyzing");
          console.log(`[Pipeline] ${session.id} — Paused: ${pendingCritical.length} action(s) awaiting confirmation`);
          progressBus.emit({
            sessionId: session.id,
            step: "confirmation",
            state: "awaiting_confirmation",
            message: `${pendingCritical.length} action${pendingCritical.length === 1 ? "" : "s"} waiting for your approval`,
            progress: 95,
            detail: pendingCritical.map((a) => a.tool).join(", "),
            pending_actions: pendingCritical.map(formatPendingAction),
          });

          try {
            await openclawClient.sendReport("meeting.awaiting_confirmation", {
              session_id: session.id,
              user_id: session.userId,
              transcript_summary: extraction.summary,
              extraction_json: extraction,
              proposed_actions: actions,
              pending_critical: pendingCritical,
            });
          } catch (err) {
            console.warn("[Pipeline] OpenClaw WS notify failed:", err);
          }
        } else {
          session.status = "complete";
          await sessionManager.save(session);
          await syncMeetingToSupabase(session, "completed");

          try {
            await openclawClient.sendReport("meeting.completed", {
              session_id: session.id,
              user_id: session.userId,
              transcript_summary: extraction.summary,
              extraction_json: extraction,
              proposed_actions: actions,
            });
          } catch (err) {
            console.warn("[Pipeline] Failed to notify OpenClaw WS:", err);
          }

          console.log(`[Pipeline] ${session.id} — Complete`);
          progressBus.emit({
            sessionId: session.id,
            step: "complete",
            state: "complete",
            message: "Meeting processing complete",
            progress: 100,
            detail: `${actions.length} actions processed`,
          });
        }

      } catch (error) {
        session.status = "error";
        await sessionManager.save(session);
        
        // Extract error message safely
        let errorMessage = "Unknown error";
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        } else {
          errorMessage = JSON.stringify(error);
        }

        progressBus.emit({
          sessionId: session.id,
          step: "error",
          message: "Meeting processing failed",
          progress: 0,
          error: errorMessage,
          detail: error instanceof Error ? error.stack : undefined,
        });
        
        console.error("[Pipeline] Failed:", errorMessage);
        console.error("[Pipeline] Stack:", error instanceof Error ? error.stack : "N/A");
      }
    })(); // Fire-and-forget async IIFE
  }
);

// ──────────────────────────────────────────────────────────────────────
// GET /sessions/:id/progress
// Server-Sent Events stream of live pipeline progress for a session.
// ──────────────────────────────────────────────────────────────────────
app.get("/sessions/:id/progress", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const user = (req as any).user;
  const session = await sessionManager.load(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found or expired" });
  }

  if (session.userId !== user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  streamSessionProgress(req, res, sessionId);
});

// ──────────────────────────────────────────────────────────────────────
// POST /sessions/:id/actions/:actionId/confirm
// Approves a critical action and notifies OpenClaw to continue.
// ──────────────────────────────────────────────────────────────────────
app.post('/sessions/:id/actions/:actionId/confirm', authMiddleware, async (req: Request, res: Response) => {
  await handleActionDecision(req, res, 'confirm');
});

// ──────────────────────────────────────────────────────────────────────
// POST /sessions/:id/actions/:actionId/refuse
// Refuses a critical action and notifies OpenClaw.
// ──────────────────────────────────────────────────────────────────────
app.post('/sessions/:id/actions/:actionId/refuse', authMiddleware, async (req: Request, res: Response) => {
  await handleActionDecision(req, res, 'refuse');
});

async function handleActionDecision(req: Request, res: Response, decision: 'confirm' | 'refuse') {
  const session_id = req.params.id as string;
  const action_id = req.params.actionId as string;
  const session = await sessionManager.load(session_id);

  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const action = session.actions?.find((a: any) => a.id === action_id);
  if (!action) return res.status(404).json({ error: 'Action not found' });

  const countStillPending = () => getPendingCriticalActions(session.actions);

  // Idempotent confirm — avoid duplicate CRM writes if user approves twice
  if (
    decision === "confirm" &&
    (action.status === "executed" ||
      (action.status === "confirmed" && action.execution_status === "success"))
  ) {
    console.log(`[Gate] Action ${action_id} already executed — skipping duplicate confirm`);
    const stillPending = countStillPending();
    if (stillPending.length === 0) {
      session.status = "complete";
    }
    await sessionManager.save(session);
    return res.json({
      action_id,
      decision: action.status,
      already_done: true,
      still_pending: stillPending.length,
    });
  }

  if (decision === "confirm" && action.status === "refused") {
    return res.status(409).json({ error: "Action was already refused" });
  }

  action.status = decision === 'confirm' ? 'confirmed' : 'refused';
  console.log(`[Gate] Action ${action_id} ${action.status.toUpperCase()}`);

  try {
    await memoryManager.updatePendingActionStatus(
      action_id,
      decision === 'confirm' ? 'approved' : 'refused'
    );
  } catch (err) {
    console.warn(`[Gate] pending_actions update failed for ${action_id}:`, (err as Error).message);
  }

  // CRM / Google Calendar: execute directly after approval — no n8n hop.
  const runsOnConfirm =
    decision === "confirm" &&
    (isCrmTool(action.tool) || action.tool === "calendar_create_event");

  if (runsOnConfirm) {
    try {
      const apiKeys = await KeyResolver.resolveKeys(session.userId);
      const execResult = await mcpDispatcher.execute(action, apiKeys);
      if (execResult.success) {
        action.status = "executed";
        action.execution_status = "success";
        action.updated_at = new Date().toISOString();
        const channel =
          action.tool === "calendar_create_event"
            ? "Google Calendar API"
            : "RapidoCRM MCP";
        console.log(`[Gate] Action ${action_id} executed via ${channel}`);
        progressBus.emit({
          sessionId: session_id,
          step: 'action',
          message: `Completed: ${action.tool.replace(/_/g, ' ')}`,
          progress: 98,
          detail: `Executed after approval via ${channel}`,
        });
      } else {
        action.execution_status = "failed";
        action.status = "pending";
        console.error(`[Gate] Action ${action_id} failed:`, execResult.error);
        progressBus.emit({
          sessionId: session_id,
          step: 'error',
          message: `Failed: ${action.tool.replace(/_/g, ' ')}`,
          progress: 98,
          error: execResult.error,
        });
      }
    } catch (err) {
      action.execution_status = "failed";
      action.status = "pending";
      console.error(`[Gate] Execution error for ${action_id}:`, (err as Error).message);
    }
  }

  const stillPending = countStillPending();

  if (stillPending.length === 0) {
    session.status = 'complete';
    await syncMeetingToSupabase(session, "completed");
    progressBus.emit({
      sessionId: session_id,
      step: 'complete',
      state: 'complete',
      message: 'All actions approved — meeting processing complete',
      progress: 100,
    });
  } else {
    session.status = "awaiting_confirmation";
    progressBus.emit({
      sessionId: session_id,
      step: "confirmation",
      state: "awaiting_confirmation",
      message: `${stillPending.length} action${stillPending.length === 1 ? "" : "s"} still waiting for your approval`,
      progress: 95,
      detail: stillPending.map((a) => a.tool).join(", "),
      pending_actions: stillPending.map(formatPendingAction),
    });
  }

  await sessionManager.save(session);

  // Notify OpenClaw
  const wsType = decision === 'confirm' ? 'meeting.action_confirmed' : 'meeting.action_refused';
  try {
    await openclawClient.sendReport(wsType as any, {
      session_id,
      user_id: session.userId,
      action_id,
      decision,
      still_pending: stillPending.length
    });
  } catch (e) {
    console.error("OpenClaw WS emit failed:", e);
  }

  return res.json({
    action_id,
    decision: action.status,
    still_pending: stillPending.length,
    pending_actions: stillPending.map(formatPendingAction),
    confirmation_actions: (session.actions ?? [])
      .filter((a) => a.requiresConfirmation)
      .map(formatConfirmationAction),
    session_status: session.status,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /session/:id
// Returns the current state of a session.
// The frontend polls this every 2 seconds to show live pipeline status.
// ─────────────────────────────────────────────────────────────────────────────

app.get("/session/:id", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const session = await sessionManager.load(sessionId);

  if (!session) {
    return res.status(404).json({
      error: `Session ${sessionId} not found or expired`
    });
  }

  const pendingCritical = getPendingCriticalActions(session.actions);
  const confirmationActions = (session.actions ?? [])
    .filter((a) => a.requiresConfirmation)
    .map(formatConfirmationAction);

  return res.json({
    ...session,
    meeting_id: session.meetingId ?? null,
    pending_actions: pendingCritical.map(formatPendingAction),
    confirmation_actions: confirmationActions,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server startup
// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, async () => {
  // Load all skills before starting
  await skillRegistry.loadAll();
  
  // Connect to OpenClaw WS
  openclawClient.connect();

  console.log(`[Server] RapidoMeet OpenClaw running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
});

// Set timeout to 30 minutes (1800000 ms) to allow long audio processing
server.setTimeout(1800000);
console.log("[Server] Request timeout set to 30 minutes for large audio files");
