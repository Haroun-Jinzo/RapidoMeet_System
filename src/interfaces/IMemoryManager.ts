import { ISessionContext } from "./ISessionContext";
import { ITask } from "./ITask";
import { IMeetingRecord } from "./IMeetingRecord";

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

// SECTION 8 — FORMATTER (formatter.ts)
// Turns pipeline results into human-readable messages.

/**
 * One formatted report in all 4 channel formats simultaneously.
 * formatter.ts produces this, notifier.ts consumes it.
 */
