import { MeetingType } from "./MeetingType";
import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";
import { ISpeakerSegment } from "./ISpeakerSegment";

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
  meetingId?:    string;        // RapidoMeet meetings.id (from upload / bot job)
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
  transcriptionSegments?: ISpeakerSegment[];
  durationSeconds?: number;
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
