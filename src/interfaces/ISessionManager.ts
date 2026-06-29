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
}
