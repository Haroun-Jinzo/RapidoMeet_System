// src/session.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Session Manager
// Interface:  ISessionManager (from interfaces.ts)
// Responsibility: Create, save, load, and delete session objects in Redis.
//                 A session tracks one meeting through the full pipeline.
// Dependencies: Redis only — no database, no AI, no filesystem.
// ─────────────────────────────────────────────────────────────────────────────

import Redis            from "ioredis";
import { nanoid }       from "nanoid";
import {
  ISessionManager,
  ISessionContext,
  MeetingType,
} from "./interfaces";

// How long a session lives in Redis before auto-deletion.
// 2 hours is more than enough for any meeting + processing time.
const SESSION_TTL_SECONDS = 60 * 60 * 2; // 7200 seconds

class SessionManager implements ISessionManager {

  // The Redis client — one connection shared across the entire app
  private redis: Redis | null = null;
  // Fallback in-memory storage for when Redis is unavailable
  private memoryStorage: Map<string, string> = new Map();
  private isRedisAvailable = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    try {
      // Connect to Redis using the environment variable.
      // ioredis handles reconnection automatically if the connection drops.
      this.redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        // Don't block on connection — lazy connect means try on first use
        lazyConnect: true,
        // Retry connection up to 2 times before giving up
        maxRetriesPerRequest: 2,
        // Connection timeout
        connectTimeout: 2000,
        tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
      });

      this.redis.on("connect", () => {
        console.log("[Session] ✅ Connected to Redis");
        this.isRedisAvailable = true;
      });

      this.redis.on("error", (err) => {
        this.isRedisAvailable = false;
        //console.warn("[Session] ⚠️  Redis unavailable — using in-memory storage:", err.message);
      });

      // Attempt initial connection but don't block if it fails
      this.redis.connect().catch(() => {
        console.warn("[Session] ⚠️  Could not connect to Redis — using in-memory storage for testing");
        this.isRedisAvailable = false;
      });
    } catch (err) {
      console.warn("[Session] ⚠️  Redis client initialization failed — using in-memory storage:", (err as Error).message);
      this.redis = null;
      this.isRedisAvailable = false;
    }
  }

  // ── PRIVATE: makeKey ───────────────────────────────────────────────────────
  // Generates the Redis key for a session.
  // Using a prefix "session:" lets us find all sessions easily with SCAN.

  private makeKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  // ── PRIVATE: generateId ────────────────────────────────────────────────────
  // Creates a human-readable unique session ID.
  // Example output: "sess_20260314_a3f9k2"
  //   - Date prefix makes it easy to find recent sessions in logs
  //   - nanoid suffix guarantees uniqueness

  private generateId(): string {
    const date = new Date()
      .toISOString()
      .slice(0, 10)          // "2026-03-14"
      .replace(/-/g, "");    // "20260314"
    const random = nanoid(6).toLowerCase(); // "a3f9k2"
    return `sess_${date}_${random}`;
  }

  // ── create ─────────────────────────────────────────────────────────────────
  // Creates a brand new session at the start of a meeting.
  // This is always the first step — nothing else can run without a session.

  async create(
    userId:       string,
    meetingTitle: string,
    meetingType:  MeetingType
  ): Promise<ISessionContext> {
    const session: ISessionContext = {
      id:           this.generateId(),
      userId,
      meetingTitle,
      meetingType,
      participants: [],           // Will be filled in from the UI or transcript
      startedAt:    new Date(),
      status:       "processing", // Pipeline starts immediately
      // transcript, extraction, actions → undefined until filled by later steps
    };

    // Save to Redis immediately
    await this.save(session);

    console.log(`[Session] Created: ${session.id} (${meetingType})`);
    return session;
  }

  // ── save ───────────────────────────────────────────────────────────────────
  // Saves (or overwrites) a session in Redis.
  // Called after EVERY step that modifies the session so state is never lost.

  async save(session: ISessionContext): Promise<void> {
    const key  = this.makeKey(session.id);

    // JSON.stringify handles the Date objects — they become ISO strings.
    // When we load back, we convert them back to Date objects.
    const data = JSON.stringify(session);

    // Try Redis first, fall back to memory
    if (this.redis && this.isRedisAvailable) {
      try {
        // SET key value EX ttl
        // The EX option means "expire after N seconds"
        await this.redis.set(key, data, "EX", SESSION_TTL_SECONDS);
      } catch {
        // If Redis fails, use memory storage
        this.memoryStorage.set(key, data);
      }
    } else {
      // Redis not available, use memory
      this.memoryStorage.set(key, data);
    }
  }

  // ── load ───────────────────────────────────────────────────────────────────
  // Retrieves a session from Redis by ID.
  // Returns null if the session has expired or was never created.

  async load(sessionId: string): Promise<ISessionContext | null> {
    const key  = this.makeKey(sessionId);
    let data: string | null = null;

    // Try Redis first
    if (this.redis && this.isRedisAvailable) {
      try {
        data = await this.redis.get(key);
      } catch {
        // Redis failed, try memory
        data = this.memoryStorage.get(key) || null;
      }
    } else {
      // Redis not available, use memory
      data = this.memoryStorage.get(key) || null;
    }

    if (!data) {
      // Session doesn't exist — either expired or wrong ID
      return null;
    }

    // Parse the JSON back into an object
    const parsed = JSON.parse(data);

    // Dates are stored as ISO strings — convert them back to Date objects
    // If we don't do this, date comparisons and formatting break
    return {
      ...parsed,
      startedAt: new Date(parsed.startedAt),
    } as ISessionContext;
  }

  // ── updateStatus ───────────────────────────────────────────────────────────
  // Changes ONLY the status of a session without a full load/save cycle.
  // This is used by the Confirmation Gate which needs to flip the status
  // quickly without loading and resaving the entire session (which may
  // include a large transcript and extraction JSON).

  async updateStatus(
    sessionId: string,
    status:    ISessionContext["status"]
  ): Promise<void> {
    // Load the full session
    const session = await this.load(sessionId);

    if (!session) {
      throw new Error(`[Session] Cannot update status: session ${sessionId} not found`);
    }

    // Modify only the status field
    session.status = status;

    // Save it back — the TTL resets to 2 hours again
    await this.save(session);

    console.log(`[Session] ${sessionId} → status: ${status}`);
  }

  // ── delete ─────────────────────────────────────────────────────────────────
  // Removes a session from Redis.
  // Called by memory.ts AFTER the session has been saved to PostgreSQL.
  // This frees up Redis memory and avoids storing duplicate data.

  async delete(sessionId: string): Promise<void> {
    const key = this.makeKey(sessionId);
    
    if (this.redis && this.isRedisAvailable) {
      try {
        await this.redis.del(key);
      } catch {
        this.memoryStorage.delete(key);
      }
    } else {
      this.memoryStorage.delete(key);
    }
    
    console.log(`[Session] Deleted: ${sessionId}`);
  }

  // ── disconnect ─────────────────────────────────────────────────────────────
  // Gracefully closes the Redis connection when the server shuts down.
  // Called by index.ts on process exit signals.

  async disconnect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
        console.log("[Session] Redis connection closed");
      } catch {
        console.warn("[Session] Redis already disconnected or unavailable");
      }
    } else {
      console.log("[Session] Using in-memory storage (no Redis to disconnect)");
    }
  }
}

// Export a single shared instance.
// Every part of the app that needs session management imports this.
export const sessionManager = new SessionManager();