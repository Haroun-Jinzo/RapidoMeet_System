import { ISkill } from "./ISkill";

/**
 * C4 Component: Skill Loader
 * File: src/skill-loader.ts
 *
 * The ONLY module that reads .md files from disk.
 * Provides auto-detection and hot-reload via Chokidar.
 * No network calls, no database — filesystem only.
 */
export interface ISkillRegistry {
  /** Load all .md files from the /skills directory into memory. */
  loadAll(): Promise<void>;

  /**
   * Get a skill by exact name.
   * Returns null if no skill with that name is loaded.
   */
  get(skillName: string): ISkill | null;

  /**
   * Automatically detect which skill best matches a transcript.
   * Counts keyword matches — highest count wins.
   * Falls back to "general" if no keywords match.
   */
  detect(transcript: string): ISkill;

  /** Return all currently loaded skills. */
  list(): ISkill[];

  /**
   * Start watching the /skills directory for file changes.
   * Any .md file saved → automatically reloaded without server restart.
   * This is the hot-reload feature.
   */
  watch(): void;
}

// SECTION 11 — PIPELINE RESULT (used by index.ts)
// The final output object returned after a full meeting is processed.

/**
 * Everything that happened during one full pipeline execution.
 * Returned by the orchestrate() function in index.ts.
 */
