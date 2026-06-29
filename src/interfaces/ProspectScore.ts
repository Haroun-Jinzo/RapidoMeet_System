/**
 * How hot a prospect is based on what was said in the meeting.
 * Determined by extract.ts using NLP analysis.
 */
export type ProspectScore = "hot" | "warm" | "cold";
