// This file is the single source of truth for the entire project.
// RULE: No implementation file may define its own types.
//       All types come from here.
// RULE: Every class in every file must implement its interface from here.
// RULE: This file has zero imports — it depends on nothing.
// ─────────────────────────────────────────────────────────────────────────────
//
// Maps to: C4 Level 3 — Component Diagram (all 10 components)
//          C4 Level 4 — Code Diagram (all interfaces)
//          UML Class Diagram — all interface definitions
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — PRIMITIVE TYPES (value objects shared across all modules)
// These are not classes. They are just named types used everywhere.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The 5 types of meetings RapidoMeet handles.
 * Each type activates a different Skill .md file.
 * "general" is the fallback when no specific skill is detected.
 */
export type MeetingType =
  | "commercial"   // Sales meetings — activates commercial.md
  | "tech"         // Sprint reviews, architecture — activates tech.md
  | "retro"        // Team retrospectives — activates retro.md
  | "onboarding"   // New client setup — activates onboarding.md
  | "general";     // No specific skill — activates general.md

/**
 * How hot a prospect is based on what was said in the meeting.
 * Determined by extract.ts using NLP analysis.
 */
export type ProspectScore = "hot" | "warm" | "cold";

/**
 * Priority level for tasks extracted from a meeting.
 */
export type Priority = "high" | "medium" | "low";

/**
 * The lifecycle of a single action in the pipeline.
 *
 * pending    → action created by router.ts, not yet executed
 * confirmed  → user approved via Confirmation Gate (for critical actions)
 * refused    → user rejected via Confirmation Gate
 * timeout    → user did not respond within 5 minutes
 * executed   → dispatcher.ts ran it successfully
 */
export type ActionStatus =
  | "pending"
  | "confirmed"
  | "refused"
  | "timeout"
  | "executed";

/**
 * The 4 output channels OpenClaw distributes reports to.
 * Each channel has a different message format.
 */
export type NotificationChannel =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "email";

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — SESSION (session.ts)
// Represents one meeting being processed from start to finish.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A session is the central object that travels through the entire pipeline.
 * Created when a meeting starts → updated at each step → saved to DB at end.
 *
 * Think of it as a backpack that holds everything we know about
 * one specific meeting at any point in time.
 */
export interface ISessionContext {
  id:            string;        // Unique ID e.g. "sess_20260314_startupx"
  userId:        string;        // Supabase user ID of who started the session
  meetingTitle:  string;        // Human readable title e.g. "Réunion StartupX"
  meetingType:   MeetingType;   // Determines which Skill .md is loaded
  participants:  string[];      // Email list of meeting participants
  startedAt:     Date;          // When processing began
  status:        "processing"   // Pipeline is running
                | "awaiting_confirmation"  // Gate waiting for user approval
                | "complete"              // All steps finished successfully
                | "error";               // Something failed

  // These are optional because they get filled in as the pipeline progresses.
  // When session is created they are undefined.
  // transcribe.ts fills in transcript
  // extract.ts fills in extraction
  // router.ts fills in actions
  transcript?:   string;
  extraction?:   INLPOutput;
  actions?:      IAction[];
}

/**
 * C4 Component: Session Manager
 * File: src/session.ts
 *
 * The ONLY module allowed to create, save, load, or delete sessions.
 * Uses Redis as storage with a 2-hour TTL (meetings don't take longer).
 */
export interface ISessionManager {
  /**
   * Creates a new session at the start of a meeting.
   * Generates a unique ID, saves to Redis, returns the session object.
   */
  create(
    userId:       string,
    meetingTitle: string,
    meetingType:  MeetingType
  ): Promise<ISessionContext>;

  /**
   * Saves the current state of a session back to Redis.
   * Called after each pipeline step updates the session.
   */
  save(session: ISessionContext): Promise<void>;

  /**
   * Loads a session from Redis by ID.
   * Returns null if the session expired (TTL passed) or never existed.
   */
  load(sessionId: string): Promise<ISessionContext | null>;

  /**
   * Updates only the status field without loading/saving the whole session.
   * Used by the Confirmation Gate to quickly flip status.
   */
  updateStatus(
    sessionId: string,
    status:    ISessionContext["status"]
  ): Promise<void>;

  /**
   * Removes a session from Redis.
   * Called after the session is saved to PostgreSQL in memory.ts.
   */
  delete(sessionId: string): Promise<void>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — TRANSCRIPTION (transcribe.ts)
// Converts audio to structured text with speaker identification.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One segment of speech from one identified speaker.
 * Example: { speaker: "Speaker 0", text: "On va commencer...", start: 0, end: 4.2 }
 */
export interface ISpeakerSegment {
  speaker:  string;   // "Speaker 0", "Speaker 1", etc.
  text:     string;   // What that speaker said
  start:    number;   // Seconds from beginning of audio
  end:      number;   // Seconds from beginning of audio
}

/**
 * Full result of transcribing one audio file or stream.
 */
export interface ITranscriptionResult {
  transcript:  string;             // Complete transcript as one string
  segments:    ISpeakerSegment[];  // Same transcript split by speaker
  duration:    number;             // Total audio duration in seconds
  confidence:  number;             // Deepgram confidence score 0.0 to 1.0
  language:    string;             // Detected language: "fr" or "en"
}

/**
 * C4 Component: Transcription
 * File: src/transcribe.ts
 *
 * The ONLY module allowed to call Deepgram.
 * Handles both file upload (Mode B, our MVP) and live stream (Mode A, bot).
 */
export interface ITranscriber {
  /**
   * Transcribes a complete audio file.
   * Used in Mode B (manual upload via the RapidoMeet UI).
   * @param audioBuffer  - The raw audio bytes
   * @param mimeType     - "audio/mp3", "audio/wav", "audio/m4a"
   * @param language     - "fr" or "en" (defaults to "fr")
   */
  transcribeFile(
    audioBuffer: Buffer,
    mimeType:    string,
    language?:   string
  ): Promise<ITranscriptionResult>;

  /**
   * Transcribes a live audio stream in real time.
   * Used in Mode A (Playwright bot captures the meeting audio).
   * @param stream     - Readable stream of audio chunks from the bot
   * @param onPartial  - Called with partial text as it arrives (for live UI)
   */
  transcribeStream(
    stream:    NodeJS.ReadableStream,
    onPartial: (text: string) => void
  ): Promise<ITranscriptionResult>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — NLP EXTRACTION (extract.ts)
// Takes a transcript and turns it into structured business data.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A task extracted from a meeting.
 * Example: "Thomas doit envoyer le devis avant vendredi"
 */
export interface ITask {
  title:     string;    // "Envoyer le devis à StartupX"
  assignee?: string;    // "Thomas" or "thomas@startupx.fr"
  deadline?: string;    // ISO date: "2026-03-21"
  priority:  Priority;  // Inferred from urgency of language
  source:    string;    // The exact quote that generated this task
}

/**
 * A decision made during the meeting.
 * Example: "On valide l'architecture N8N"
 */
export interface IDecision {
  text:   string;    // "Architecture N8N + Node.js validée"
  owner?: string;    // Who is responsible for this decision
}

/**
 * A prospect or client identified during a meeting.
 */
export interface IProspect {
  company:   string;         // "StartupX"
  contact?:  string;         // "Thomas Laurent"
  email?:    string;         // "thomas@startupx.fr"
  phone?:    string;         // "+33 6 12 34 56 78"
  score:     ProspectScore;  // hot/warm/cold based on meeting language
  interest?: string;         // "Plan Pro à 200€/mois"
  nextStep?: string;         // "Démo technique le 21 mars"
}

/**
 * The complete structured output of NLP analysis on a transcript.
 * This is what extract.ts produces and router.ts consumes.
 */
export interface INLPOutput {
  summary:   string;                        // 2-3 sentence meeting summary
  sentiment: "positive" | "neutral" | "negative";
  tasks:     ITask[];
  decisions: IDecision[];
  prospects: IProspect[];
  skillUsed: string;  // Name of the .md file that was active: "commercial"
}

/**
 * C4 Component: NLP Extractor
 * File: src/extract.ts
 *
 * The ONLY module allowed to call the AI model for extraction.
 * Takes a transcript + Skill content → returns structured INLPOutput.
 */
export interface ITaskExtractor {
  extract(
    transcript:   string,      // Full meeting transcript text
    meetingType:  MeetingType, // Guides the extraction focus
    skillContent: string       // Contents of the active .md Skill file
  ): Promise<INLPOutput>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — ROUTING (router.ts)
// Decides WHAT to do based on what was extracted.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * All possible MCP tool calls the dispatcher can execute.
 * These map directly to N8N webhook paths.
 */
export type MCPTool =
  | "crm_create_contact"      // Creates a contact in RapidoCRM
  | "crm_create_opportunity"  // Creates a sales opportunity
  | "crm_log_activity"        // Logs meeting notes on existing contact
  | "calendar_create_event"   // Creates Google Calendar event
  | "email_send_recap"        // Sends HTML recap email to participants
  | "db_save_task"            // Saves a task to PostgreSQL
  | "n8n_trigger_workflow";   // Triggers a custom N8N workflow by name

/**
 * One atomic action the dispatcher will execute.
 *
 * The requiresConfirmation flag is the Confirmation Gate trigger.
 * When true: pipeline pauses, user is notified, must approve before dispatch.
 * When false: dispatcher executes immediately, no human needed.
 */
export interface IAction {
  id:                   string;                   // "action_001", "action_002"
  tool:                 MCPTool;                  // Which MCP tool to call
  params:               Record<string, unknown>;  // Arguments for the tool
  requiresConfirmation: boolean;                  // true = Confirmation Gate
  status:               ActionStatus;             // Current state
  result?:              string;                   // Filled after execution
  execution_status?:    string;                   // Detailed openclaw final status ('completed', 'failed', 'running')
  execution_result?:    any;                      // Output captured from OpenClaw pipeline
  updated_at?:          string;                   // Last execution update time
}

/**
 * C4 Component: Intent Router
 * File: src/router.ts
 *
 * The ONLY module allowed to call the AI model for routing decisions.
 * Takes extraction output → returns ordered list of actions to execute.
 */
export interface IIntentRouter {
  decide(
    extraction:   INLPOutput,  // What was found in the meeting
    sessionId:    string,      // For logging and tracing
    skillContent: string       // Active Skill file may override routing rules
  ): Promise<IAction[]>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 — DISPATCHER (dispatcher.ts)
// Executes actions by calling N8N webhooks.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Result of executing one action via N8N.
 */
export interface IDispatchResult {
  actionId:  string;   // Matches IAction.id
  success:   boolean;
  result?:   string;   // What N8N returned on success
  error?:    string;   // Error message on failure
  retries:   number;   // How many times we retried (max 3)
}

/**
 * C4 Component: MCP Dispatcher
 * File: src/dispatcher.ts
 *
 * The ONLY module allowed to call N8N webhooks.
 * Handles retry logic (max 3 attempts) and reports results.
 */
export interface IMCPDispatcher {
  /**
   * Execute one non-critical action immediately.
   * Used for: calendar events, email recaps, saving tasks.
   */
  execute(action: IAction): Promise<IDispatchResult>;

  /**
   * Execute all non-critical actions in a session in order.
   * Skips any action where requiresConfirmation is true.
   */
  executeAll(
    actions:   IAction[],
    sessionId: string
  ): Promise<IDispatchResult[]>;

  /**
   * Resume a previously suspended critical action after Gate approval.
   * Called by index.ts when the user confirms via the UI or Telegram.
   */
  resume(
    action:    IAction,
    sessionId: string
  ): Promise<IDispatchResult>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7 — MEMORY (memory.ts)
// Short-term cache (Redis) and long-term storage (PostgreSQL).
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A completed meeting stored permanently in PostgreSQL.
 * Created when a session reaches "complete" status.
 */
export interface IMeetingRecord {
  id:          string;         // PostgreSQL UUID
  userId:      string;         // Supabase user ID
  title:       string;
  type:        MeetingType;
  transcript:  string;
  extraction:  INLPOutput;     // Stored as JSONB in Postgres
  actions:     IAction[];      // Stored as JSONB in Postgres
  createdAt:   Date;
  duration:    number;         // Meeting duration in seconds
}

/**
 * C4 Component: Memory Manager
 * File: src/memory.ts
 *
 * The ONLY module allowed to query PostgreSQL or Redis directly.
 * Two clear responsibilities:
 *   - Redis: fast temporary storage for active sessions
 *   - PostgreSQL: permanent storage for completed meetings and tasks
 */
export interface IMemoryManager {
  // ── Redis methods (short-term, session cache) ──────────────────────────

  /**
   * Store a session in Redis with a TTL.
   * Default TTL is 7200 seconds (2 hours) — enough for any meeting.
   */
  cacheSession(session: ISessionContext, ttlSeconds?: number): Promise<void>;

  /**
   * Retrieve a session from Redis.
   * Returns null if expired or not found.
   */
  getSession(sessionId: string): Promise<ISessionContext | null>;

  /** Remove a session from Redis after it has been saved to PostgreSQL. */
  deleteSession(sessionId: string): Promise<void>;

  // ── PostgreSQL methods (long-term, permanent) ─────────────────────────

  /**
   * Save a completed meeting to the database.
   * Returns the database-generated UUID.
   */
  saveMeeting(meeting: Omit<IMeetingRecord, "id">): Promise<string>;

  /** Retrieve one meeting by its database ID. */
  getMeeting(meetingId: string): Promise<IMeetingRecord | null>;

  /**
   * List meetings for a user, newest first.
   * @param limit - Max records to return (default 20)
   */
  listMeetings(userId: string, limit?: number): Promise<IMeetingRecord[]>;

  /**
   * Save a single task to PostgreSQL.
   * Returns the database-generated UUID.
   */
  saveTask(
    task: ITask & { sessionId: string; userId: string }
  ): Promise<string>;

  /**
   * List tasks for a user.
   * @param onlyOpen - If true, excludes tasks marked as done
   */
  listTasks(
    userId:    string,
    onlyOpen?: boolean
  ): Promise<(ITask & { id: string; done: boolean })[]>;

  /** Mark a task as completed in the database. */
  markTaskDone(taskId: string): Promise<void>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8 — FORMATTER (formatter.ts)
// Turns pipeline results into human-readable messages.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One formatted report in all 4 channel formats simultaneously.
 * formatter.ts produces this, notifier.ts consumes it.
 */
export interface IFormattedReport {
  telegram: string;   // Telegram MarkdownV2 format, max 4096 chars
  whatsapp: string;   // Plain text, emojis OK, max 1600 chars
  discord:  string;   // Discord markdown format
  email: {
    subject: string;
    html:    string;   // Full HTML email with inline CSS
    text:    string;   // Plain text fallback for email clients without HTML
  };
}

/**
 * C4 Component: Report Formatter
 * File: src/formatter.ts
 *
 * The ONLY module that builds message strings.
 * Pure function — no network calls, no database access.
 * Input: session + results → Output: formatted strings.
 */
export interface IReportFormatter {
  format(
    session: ISessionContext,
    results: IDispatchResult[]
  ): IFormattedReport;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 9 — NOTIFIER (notifier.ts)
// Sends formatted reports to all output channels via OpenClaw.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Result of one notification attempt on one channel.
 */
export interface INotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?:  string;  // Only present if success is false
}

/**
 * C4 Component: Notifier
 * File: src/notifier.ts
 *
 * The ONLY module that calls OpenClaw to send messages.
 * Receives a formatted report → distributes to all configured channels.
 */
export interface INotifier {
  /**
   * Send the report to all specified channels simultaneously.
   * Uses Promise.allSettled — one channel failing does not stop others.
   */
  notifyAll(
    report:    IFormattedReport,
    channels:  NotificationChannel[],
    sessionId: string
  ): Promise<INotificationResult[]>;

  /**
   * Send a single message to one specific channel.
   * Used by the Confirmation Gate to notify the user of a pending action.
   */
  notify(
    channel:   NotificationChannel,
    message:   string,
    sessionId: string
  ): Promise<INotificationResult>;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 10 — SKILL REGISTRY (skill-loader.ts)
// Manages the .md behaviour files that customise the agent per meeting type.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One loaded Skill file with its parsed metadata.
 */
export interface ISkill {
  name:     string;    // "commercial" (filename without .md)
  version:  string;    // Parsed from the frontmatter: version: "1.2"
  triggers: string[];  // Keywords that auto-detect this skill
  content:  string;    // Full .md file content (given to extract.ts + router.ts)
  path:     string;    // Absolute file path on disk
  loadedAt: Date;      // When it was last loaded/reloaded
}

/**
 * C4 Component: Skill Loader
 * File: src/skill-loader.ts
 *
 * The ONLY module that reads .md files from disk.
 * Provides auto-detection and hot-reload via Chokidar.
 * No network calls, no database — filesystem only.
 */
export interface ISkillRegistry {
  /** Load all .md files from the /skills directory into memory. */
  loadAll(): Promise<void>;

  /**
   * Get a skill by exact name.
   * Returns null if no skill with that name is loaded.
   */
  get(skillName: string): ISkill | null;

  /**
   * Automatically detect which skill best matches a transcript.
   * Counts keyword matches — highest count wins.
   * Falls back to "general" if no keywords match.
   */
  detect(transcript: string): ISkill;

  /** Return all currently loaded skills. */
  list(): ISkill[];

  /**
   * Start watching the /skills directory for file changes.
   * Any .md file saved → automatically reloaded without server restart.
   * This is the hot-reload feature.
   */
  watch(): void;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 11 — PIPELINE RESULT (used by index.ts)
// The final output object returned after a full meeting is processed.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Everything that happened during one full pipeline execution.
 * Returned by the orchestrate() function in index.ts.
 */
export interface IPipelineResult {
  sessionId:     string;
  transcript:    string;
  extraction:    INLPOutput;
  actions:       IAction[];
  results:       IDispatchResult[];
  report:        IFormattedReport;
  notifications: INotificationResult[];
  durationMs:    number;   // Total processing time in milliseconds
}