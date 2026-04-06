import { MeetingType } from "./MeetingType";
import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";

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
