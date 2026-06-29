import { ISkill } from "./ISkill";

/**
 * C4 Component: Skill Loader
 * File: src/skill-loader.ts
 *
 * The ONLY module that reads .md files from disk.
 * Provides auto-detection from transcript keywords.
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
}
