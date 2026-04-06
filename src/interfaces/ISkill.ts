/**
 * One loaded Skill file with its parsed metadata.
 */
export interface ISkill {
  name:     string;    // "commercial" (filename without .md)
  version:  string;    // Parsed from the frontmatter: version: "1.2"
  triggers: string[];  // Keywords that auto-detect this skill
  content:  string;    // Full .md file content (given to extract.ts + router.ts)
  path:     string;    // Absolute file path on disk
  loadedAt: Date;      // When it was last loaded/reloaded
}

/**
 * C4 Component: Skill Loader
 * File: src/skill-loader.ts
 *
 * The ONLY module that reads .md files from disk.
 * Provides auto-detection and hot-reload via Chokidar.
 * No network calls, no database — filesystem only.
 */
