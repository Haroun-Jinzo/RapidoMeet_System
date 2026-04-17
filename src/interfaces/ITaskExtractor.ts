import { MeetingType } from "./MeetingType";
import { INLPOutput } from "./INLPOutput";

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
    skillContent: string,      // Contents of the active .md Skill file
    apiKeys?:     any
  ): Promise<INLPOutput>;
}

// SECTION 5 — ROUTING (router.ts)
// Decides WHAT to do based on what was extracted.

/**
 * All possible MCP tool calls the dispatcher can execute.
 * These map directly to N8N webhook paths.
 */
