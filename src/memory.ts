// src/memory.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Memory Manager
// Interface:  IMemoryManager (from interfaces.ts)
// Responsibility: Short-term cache (Redis via sessionManager) and
//                 long-term storage (PostgreSQL) for meetings and tasks.
// Dependencies: sessionManager (for Redis), PostgreSQL (pg library).
// ─────────────────────────────────────────────────────────────────────────────

import { Pool }    from "pg";
import { nanoid }  from "nanoid";
import {
  IMemoryManager,
  ISessionContext,
  IMeetingRecord,
  ITask,
} from "./interfaces";
import { sessionManager } from "./session"; // reuse Redis from sessionManager

class MemoryManager implements IMemoryManager {

  // PostgreSQL connection pool.
  // A pool manages multiple connections — important because our pipeline
  // makes several DB calls that could overlap in async code.
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Keep up to 10 connections open
      // For a prototype, 5 would be fine too
      max: 10,
      // Close idle connections after 30 seconds
      idleTimeoutMillis: 30_000,
      // Fail fast if we can't connect
      connectionTimeoutMillis: 5_000,
    });

    // Test the connection at startup
    this.pool.query("SELECT NOW()")
      .then(() => console.log("[Memory] PostgreSQL connected"))
      .catch(err => console.error("[Memory] PostgreSQL connection failed:", err.message));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REDIS METHODS (short-term session cache)
  // These delegate to sessionManager — we do NOT create a second Redis client.
  // ══════════════════════════════════════════════════════════════════════════

  async cacheSession(
    session:    ISessionContext,
    ttlSeconds: number = 7200
  ): Promise<void> {
    // sessionManager.save() already handles TTL
    // We just call it directly
    await sessionManager.save(session);
  }

  async getSession(sessionId: string): Promise<ISessionContext | null> {
    return sessionManager.load(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return sessionManager.delete(sessionId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POSTGRESQL METHODS (long-term permanent storage)
  // ══════════════════════════════════════════════════════════════════════════

  // ── saveMeeting ────────────────────────────────────────────────────────────
  // Stores a completed meeting permanently in PostgreSQL.
  // Called once at the very end of the pipeline when status = "complete".
  // Returns the database-generated UUID for the meeting record.

  async saveMeeting(
    meeting: Omit<IMeetingRecord, "id">
  ): Promise<string> {
    const id = nanoid();

    // We store extraction and actions as JSONB columns.
    // JSONB in PostgreSQL is stored in a binary format that allows
    // efficient querying e.g. SELECT * WHERE extraction->>'sentiment' = 'positive'
    const query = `
      INSERT INTO meetings (
        id,
        user_id,
        title,
        type,
        transcript,
        extraction,
        actions,
        created_at,
        duration
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb,
        $7::jsonb,
        $8, $9
      )
      RETURNING id
    `;

    const values = [
      id,
      meeting.userId,
      meeting.title,
      meeting.type,
      meeting.transcript,
      JSON.stringify(meeting.extraction),   // Object → JSON string → JSONB
      JSON.stringify(meeting.actions),       // Object → JSON string → JSONB
      meeting.createdAt,
      meeting.duration,
    ];

    const result = await this.pool.query(query, values);
    const savedId = result.rows[0].id;

    console.log(`[Memory] Meeting saved to PostgreSQL: ${savedId}`);
    return savedId;
  }

  // ── getMeeting ─────────────────────────────────────────────────────────────
  // Retrieves one meeting by its database ID.
  // Used by the S4 Rapport screen to display the full meeting report.

  async getMeeting(meetingId: string): Promise<IMeetingRecord | null> {
    const query = `
      SELECT
        id,
        user_id       AS "userId",
        title,
        type,
        transcript,
        extraction,   -- JSONB: PostgreSQL returns this as an object automatically
        actions,      -- JSONB: same
        created_at    AS "createdAt",
        duration
      FROM meetings
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [meetingId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // PostgreSQL returns JSONB columns as already-parsed JS objects.
    // We still need to convert the date string back to a Date object.
    return {
      ...row,
      createdAt: new Date(row.createdAt),
    } as IMeetingRecord;
  }

  // ── listMeetings ───────────────────────────────────────────────────────────
  // Returns a list of meetings for one user, newest first.
  // Used by the S6 Réunions screen.

  async listMeetings(
    userId: string,
    limit:  number = 20
  ): Promise<IMeetingRecord[]> {
    const query = `
      SELECT
        id,
        user_id    AS "userId",
        title,
        type,
        transcript,
        extraction,
        actions,
        created_at AS "createdAt",
        duration
      FROM meetings
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [userId, limit]);

    return result.rows.map(row => ({
      ...row,
      createdAt: new Date(row.createdAt),
    })) as IMeetingRecord[];
  }

  // ── saveTask ───────────────────────────────────────────────────────────────
  // Saves one task extracted from a meeting.
  // Each task gets its own row — easier to query, update, and display.
  // Called by dispatcher.ts when executing the "db.save_task" action.

  async saveTask(
    task: ITask & { sessionId: string; userId: string }
  ): Promise<string> {
    const id = nanoid();

    const query = `
      INSERT INTO tasks (
        id,
        user_id,
        session_id,
        title,
        assignee,
        deadline,
        priority,
        source,
        done,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        false,    -- tasks start as not done
        NOW()
      )
      RETURNING id
    `;

    const values = [
      id,
      task.userId,
      task.sessionId,
      task.title,
      task.assignee  || null,
      task.deadline  || null,
      task.priority,
      task.source,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0].id;
  }

  // ── listTasks ──────────────────────────────────────────────────────────────
  // Returns tasks for one user.
  // Used by the S7 Tâches screen.

  async listTasks(
    userId:    string,
    onlyOpen:  boolean = false
  ): Promise<(ITask & { id: string; done: boolean })[]> {
    const query = `
      SELECT
        id,
        title,
        assignee,
        deadline,
        priority,
        source,
        done
      FROM tasks
      WHERE user_id = $1
        ${onlyOpen ? "AND done = false" : ""}
      ORDER BY
        CASE priority
          WHEN 'high'   THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 3
        END,
        created_at DESC
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // ── markTaskDone ───────────────────────────────────────────────────────────
  // Marks one task as completed.
  // Called when the user ticks a checkbox in the S7 Tâches screen.

  async markTaskDone(taskId: string): Promise<void> {
    await this.pool.query(
      "UPDATE tasks SET done = true WHERE id = $1",
      [taskId]
    );
    console.log(`[Memory] Task marked done: ${taskId}`);
  }

  // ── disconnect ─────────────────────────────────────────────────────────────
  // Gracefully closes the PostgreSQL pool when the server shuts down.

  async disconnect(): Promise<void> {
    await this.pool.end();
    console.log("[Memory] PostgreSQL pool closed");
  }
}

// Export a single shared instance.
export const memoryManager = new MemoryManager();