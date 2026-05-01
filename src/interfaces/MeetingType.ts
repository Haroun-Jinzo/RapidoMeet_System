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
  | "general"
  | "phone_call";    // Phone calls — activates phone_call.md

/**
 * How hot a prospect is based on what was said in the meeting.
 * Determined by extract.ts using NLP analysis.
 */
