// src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 1: Server Entry Point
// Responsibility: Start Express server, set up routes, manage request pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load environment variables from .env file
dotenv.config();

// Import all module instances
import { transcriber } from "./transcribe";
import { taskExtractor } from "./extract";
import { intentRouter } from "./router";
import { mcpDispatcher } from "./dispatcher";
import { sessionManager } from "./session";
import { skillRegistry } from "./skill-loader";
import { memoryManager } from "./memory";
import { reportFormatter } from "./formatter";
import { requireAuth } from "./middleware/auth";
import { internalRouter } from "./internal/tokenBroker";
import { openclawClient } from "./openclaw/OpenClawClient";

import multer from "multer";
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

// Internal routes (OpenClaw -> RapidoMeet via shared secret)
app.use('/internal', internalRouter);

// Custom file handling - expects audio data in req.body
const handleAudioUpload = (req: Request & { file?: any }, res: Response, next: NextFunction) => {
  if (req.body.audio && typeof req.body.audio === "string") {
    // If audio is base64-encoded in the body
    req.file = {
      buffer: Buffer.from(req.body.audio, "base64"),
      mimetype: req.body.audio_type || "audio/wav"
    } as any;
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
  async (req: Request & { file?: { buffer: Buffer; mimetype: string } }, res: Response) => {
    const user = (req as any).user;

    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const {
      meeting_title = "Réunion sans titre",
      meeting_type  = "general",
      language      = "fr",
      participants  = "",
    } = req.body;

    // ── Step 1: Create session ─────────────────────────────────────────────
    const session = await sessionManager.create(
      user.id,
      meeting_title,
      meeting_type as any
    );

    // Parse participants from comma-separated string to array
    session.participants = participants
      ? participants.split(",").map((p: string) => p.trim()).filter(Boolean)
      : [];

    await sessionManager.save(session);

    try {
      // ── Step 2: Transcribe ───────────────────────────────────────────────
      console.log(`[Pipeline] ${session.id} — Step 1: Transcription`);
      const transcription = await transcriber.transcribeFile(
        req.file.buffer,
        req.file.mimetype,
        language
      );
      session.transcript = transcription.transcript;
      await sessionManager.save(session);

      // ── Step 3: Detect skill + Extract ──────────────────────────────────
      console.log(`[Pipeline] ${session.id} — Step 2: Skill detection`);
      const skill = skillRegistry.get(meeting_type)
        || skillRegistry.detect(transcription.transcript);

      console.log(`[Pipeline] ${session.id} — Step 3: NLP extraction`);
      const extraction = await taskExtractor.extract(
        transcription.transcript,
        meeting_type as any,
        skill.content
      );
      session.extraction = extraction;
      await sessionManager.save(session);

      // ── Step 4: Route — decide actions ──────────────────────────────────
      console.log(`[Pipeline] ${session.id} — Step 4: Intent routing`);
      const actions = await intentRouter.decide(
        extraction,
        session.id,
        skill.content
      );
      session.actions = actions;
      await sessionManager.save(session);

      // ── Step 5: Check for critical actions ──────────────────────────────
      const pendingCritical = actions.filter(
        a => a.requiresConfirmation && a.status === "pending"
      );

      if (pendingCritical.length > 0) {
        // Pipeline pauses here — session goes into awaiting_confirmation
        session.status = "awaiting_confirmation";
        await sessionManager.save(session);

        console.log(
          `[Pipeline] ${session.id} — Paused: ` +
          `${pendingCritical.length} action(s) awaiting confirmation`
        );

        // Notify OpenClaw about awaiting confirmation
        try {
          await openclawClient.sendReport("meeting.awaiting_confirmation", {
            session_id: session.id,
            user_id: session.userId,
            transcript_summary: extraction.summary,
            extraction_json: extraction,
            proposed_actions: actions,
            pending_critical: pendingCritical,
          });
        } catch(err) { 
          console.warn("[Pipeline] OpenClaw WS notify failed:", err); 
        }

        return res.json({
          session_id:       session.id,
          status:           "awaiting_confirmation",
          transcription:    { transcript: transcription.transcript, duration: transcription.duration },
          extraction,
          actions,
          pending_critical: pendingCritical.map(a => ({
            action_id: a.id,
            tool:      a.tool,
            params:    a.params,
          })),
          message: `${pendingCritical.length} action(s) require your confirmation before executing.`,
        });
      }

      // ── Step 5: Delegate Executions to OpenClaw ────────────────────────────
      console.log(`[Pipeline] ${session.id} — Step 5: OpenClaw Delegation`);

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
      
      const results: any[] = [];
      let notifications: any[] = []; // handled by OpenClaw now

      // Save completed meeting to PostgreSQL (non-fatal if fails)
      try {
        await memoryManager.saveMeeting({
          userId:     user.id,
          title:      meeting_title,
          type:       meeting_type as any,
          transcript: transcription.transcript,
          extraction,
          actions,
          createdAt:  new Date(),
          duration:   transcription.duration,
        });
      } catch (dbErr) {
        console.warn("[Pipeline] Database save failed (non-fatal):", (dbErr as Error).message);
      }

      // Upload audio to Supabase for persistent storage (non-fatal if fails)
      let audioStoragePath: string | null = null;
      try {
        audioStoragePath = await uploadAudioToSupabase(
          req.file!.buffer,
          session.id,
          req.file!.mimetype
        );
      } catch (storageErr) {
        console.warn("[Pipeline] Supabase storage failed (non-fatal):", (storageErr as Error).message);
      }

      session.status = "complete";
      await sessionManager.save(session);

      console.log(`[Pipeline] ${session.id} — Complete`);

      return res.json({
        session_id:  session.id,
        status:      "complete",
        transcription: {
          transcript: transcription.transcript,
          duration:   transcription.duration,
          confidence: transcription.confidence,
        },
        extraction,
        actions,
        results,
        notifications_sent: notifications,
        
        skill_used:  skill.name,
        audio_storage: audioStoragePath ? { path: audioStoragePath, bucket: AUDIO_BUCKET } : null,
      });

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
      
      console.error("[Pipeline] Failed:", errorMessage);
      console.error("[Pipeline] Stack:", error instanceof Error ? error.stack : "N/A");
      
      return res.status(500).json({
        session_id: session.id,
        error:      "Pipeline failed",
        detail:     errorMessage,
      });
    }
  }
);

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

  action.status = decision === 'confirm' ? 'confirmed' : 'refused';
  console.log(`[Gate] Action ${action_id} ${action.status.toUpperCase()}`);

  const stillPending = session.actions?.filter(
    (a: any) => a.requiresConfirmation && a.status === 'pending' && a.id !== action_id
  ) || [];

  if (stillPending.length === 0) {
    session.status = 'complete';
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

  return res.json(session);
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
