import { MeetingType } from "./MeetingType";
import { ISessionContext } from "./ISessionContext";

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

// SECTION 3 — TRANSCRIPTION (transcribe.ts)
// Converts audio to structured text with speaker identification.

/**
 * One segment of speech from one identified speaker.
 * Example: { speaker: "Speaker 0", text: "On va commencer...", start: 0, end: 4.2 }
 */
