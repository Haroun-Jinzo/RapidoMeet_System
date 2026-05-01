// src/skill-loader.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Skill Loader
// Interface:  ISkillRegistry (from interfaces.ts)
// Responsibility: Load .md Skill files from disk, detect skills from
//                 transcripts, hot-reload on file changes.
// Dependencies: filesystem only — no network, no database, no AI calls.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from "fs";
import * as path from "path";
import matter    from "gray-matter";  // parses YAML frontmatter from .md files
import chokidar  from "chokidar";     // watches files for changes

import { ISkill, ISkillRegistry, MeetingType } from "./interfaces";

class SkillLoader implements ISkillRegistry {

  // In-memory store: skill name → skill object
  // We use a Map so lookups are O(1)
  private skills: Map<string, ISkill> = new Map();

  // The directory where .md files are stored
  // Can be overridden via environment variable
  private skillsDir: string;

  constructor() {
    this.skillsDir = process.env.SKILLS_DIR
      ? path.resolve(process.env.SKILLS_DIR)
      : path.resolve(__dirname, "../skills");
  }

  // ── loadAll ────────────────────────────────────────────────────────────────
  // Called once at server startup.
  // Reads every .md file in the skills directory and loads it into memory.

  async loadAll(): Promise<void> {
    // Create the skills directory if it does not exist
    // This prevents crashes if the folder was accidentally deleted
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      console.log(`[SkillLoader] Created skills directory: ${this.skillsDir}`);
    }

    // Read all files in the directory
    const files = fs.readdirSync(this.skillsDir)
      .filter(f => f.endsWith(".md"));  // Only process Markdown files

    if (files.length === 0) {
      console.warn(`[SkillLoader] Warning: no .md files found in ${this.skillsDir}`);
      this.createDefaultSkills();  // Create default skills so system doesn't break
      return;
    }

    // Load each file
    for (const file of files) {
      await this.loadFile(path.join(this.skillsDir, file));
    }

    console.log(`[SkillLoader] Loaded ${this.skills.size} skills: ${[...this.skills.keys()].join(", ")}`);
  }

  // ── loadFile ───────────────────────────────────────────────────────────────
  // Internal helper that reads and parses one .md file.
  // Called by loadAll() at startup and by the file watcher when files change.

  private async loadFile(filePath: string): Promise<void> {
    try {
      const rawContent = fs.readFileSync(filePath, "utf-8");

      // gray-matter splits the file into:
      //   parsed.data    → the YAML frontmatter object
      //   parsed.content → the Markdown body below the --- lines
      //
      // Example .md file:
      //   ---
      //   name: commercial
      //   version: "1.2"
      //   trigger: prospect, devis, client, vente
      //   ---
      //   ## Instructions pour réunions commerciales
      //   ...
      const parsed = matter(rawContent);

      // Extract the skill name from frontmatter, fall back to filename
      const name = (parsed.data.name as string)
        || path.basename(filePath, ".md");

      // Parse trigger keywords — they may be a comma-separated string or array
      let triggers: string[] = [];
      if (parsed.data.trigger) {
        if (typeof parsed.data.trigger === "string") {
          triggers = parsed.data.trigger
            .split(",")
            .map((t: string) => t.trim().toLowerCase())
            .filter((t: string) => t.length > 0);
        } else if (Array.isArray(parsed.data.trigger)) {
          triggers = parsed.data.trigger.map((t: string) => t.toLowerCase().trim());
        }
      }

      const skill: ISkill = {
        name,
        version:  (parsed.data.version as string) || "1.0",
        triggers,
        content:  rawContent,  // Store the FULL file content (frontmatter + body)
        path:     filePath,
        loadedAt: new Date(),
      };

      this.skills.set(name, skill);
      console.log(`[SkillLoader] Loaded: ${name} v${skill.version} (${triggers.length} triggers)`);

    } catch (error) {
      // Log the error but don't crash the server
      // A broken skill file should not take down the whole system
      console.error(`[SkillLoader] Failed to load ${filePath}:`, (error as Error).message);
    }
  }

  // ── get ────────────────────────────────────────────────────────────────────
  // Returns a skill by exact name, or null if not found.

  get(skillName: string): ISkill | null {
    return this.skills.get(skillName) || null;
  }

  // ── detect ─────────────────────────────────────────────────────────────────
  // Automatically detects which skill best matches a transcript.
  //
  // Algorithm:
  //   1. Lowercase the full transcript
  //   2. For each skill, count how many of its trigger keywords appear
  //   3. The skill with the most keyword matches wins
  //   4. If no keywords match at all, return the "general" skill
  //
  // This is intentionally simple — more sophisticated ML-based detection
  // can replace this logic without changing the interface.

  detect(transcript: string): ISkill {
    const lowerTranscript = transcript.toLowerCase();

    let bestSkill: ISkill | null = null;
    let bestScore  = 0;

    for (const skill of this.skills.values()) {
      // Skip "general" during scoring — it's the fallback
      if (skill.name === "general") continue;

      let score = 0;
      for (const trigger of skill.triggers) {
        // Count occurrences, not just presence
        // "prospect" appearing 5 times is stronger signal than once
        const regex = new RegExp(trigger, "gi");
        const matches = lowerTranscript.match(regex);
        if (matches) score += matches.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestSkill = skill;
      }
    }

    // If we found a clear winner, return it
    if (bestSkill && bestScore > 0) {
      console.log(`[SkillLoader] Detected skill: ${bestSkill.name} (score: ${bestScore})`);
      return bestSkill;
    }

    // Fall back to general skill
    const general = this.skills.get("general");
    if (general) {
      console.log(`[SkillLoader] No skill detected, using: general`);
      return general;
    }

    // If even general doesn't exist, something is very wrong
    throw new Error("[SkillLoader] No skills loaded — call loadAll() first");
  }

  // ── list ───────────────────────────────────────────────────────────────────
  // Returns all loaded skills as an array.
  // Used by the /skills API endpoint to show the UI what's available.

  list(): ISkill[] {
    return [...this.skills.values()];
  }

  // ── watch ──────────────────────────────────────────────────────────────────
  // Starts watching the skills directory for file changes.
  // Any .md file that is added, modified, or deleted → reloads automatically.
  // This is the hot-reload feature — no server restart needed.

  watch(): void {
    console.log(`[SkillLoader] Watching for changes in: ${this.skillsDir}`);

    const watcher = chokidar.watch(
      path.join(this.skillsDir, "*.md"),
      {
        persistent: true,     // Keep watching even when other work is done
        ignoreInitial: true,  // Don't fire events for files loaded at startup
      }
    );

    // File added → load it
    watcher.on("add", (filePath) => {
      console.log(`[SkillLoader] New skill file detected: ${filePath}`);
      this.loadFile(filePath);
    });

    // File modified → reload it
    watcher.on("change", (filePath) => {
      const skillName = path.basename(filePath, ".md");
      console.log(`[SkillLoader] Skill changed, reloading: ${skillName}`);
      this.loadFile(filePath);
    });

    // File deleted → remove from memory
    watcher.on("unlink", (filePath) => {
      const skillName = path.basename(filePath, ".md");
      this.skills.delete(skillName);
      console.log(`[SkillLoader] Skill removed: ${skillName}`);
    });

    watcher.on("error", (error) => {
      console.error("[SkillLoader] Watcher error:", error);
    });
  }

  // ── createDefaultSkills ────────────────────────────────────────────────────
  // Creates default .md files if the skills directory is empty.
  // Ensures the system always has something to work with.

  private createDefaultSkills(): void {
    const defaults: Record<string, string> = {
      "general.md": `---
name: general
version: "1.0"
trigger: réunion, meeting, discussion, appel
---

## Instructions générales

Pour chaque réunion :
1. Extraire toutes les tâches mentionnées avec leurs assignés
2. Identifier les décisions prises
3. Résumer les points clés en 2-3 phrases
4. Envoyer un récapitulatif à tous les participants
`,
      "commercial.md": `---
name: commercial
version: "1.2"
trigger: prospect, devis, client, vente, commercial, pipeline, offre, contrat
---

## Instructions pour réunions commerciales

Priorités d'extraction :
- Identifier TOUS les prospects mentionnés
- Extraire les engagements chiffrés (montants, délais)
- Détecter le niveau d'intérêt : chaud / tiède / froid

Actions à déclencher :
- Si nouveau contact → create_contact dans RapidoCRM (CRITIQUE — confirmation requise)
- Si RDV convenu → create_event dans Calendar (automatique)
- Toujours → log_activity sur le contact existant
- Toujours → send_recap aux participants

Format du rapport :
- Prospects en premier avec leur score
- Tâches triées par priorité
- Next steps en conclusion
`,
      "tech.md": `---
name: tech
version: "1.0"
trigger: sprint, bug, PR, review, architecture, technique, déploiement, API
---

## Instructions pour réunions techniques

Priorités d'extraction :
- Décisions d'architecture
- Bugs identifiés avec responsable
- Tâches de développement avec deadline

Actions à déclencher :
- Chaque tâche → db.save_task (automatique)
- Décisions → log dans le rapport
- send_recap à l'équipe technique
`,
      "onboarding.md": `---
name: onboarding
version: "1.0"
trigger: onboarding, nouveau client, setup, formation, configuration, accès
---

## Instructions pour réunions d'onboarding

Priorités d'extraction :
- Informations du nouveau client (contact, email, société)
- Accès à configurer
- Formation à planifier

Actions à déclencher :
- Créer contact client dans RapidoCRM (CRITIQUE)
- Planifier sessions de suivi dans Calendar
- send_recap avec liste des accès à créer
`,
"phone_call.md": `---
name: phone_call
version: "1.0"
trigger: phone, appel, téléphone, call, mobile, conversation téléphonique
---

Note: This is a transcript of a phone conversation. There may be informal language, interruptions, or incomplete sentences. Focus on extracting clear action items, decisions, and prospects even if the conversation is less structured than a formal meeting.

## Instructions pour appels téléphoniques

Priorités d'extraction :
- Identifier les participants à l'appel
- Extraire les tâches/action items même si la formulation est informelle
- Repérer les décisions prises, même implicites
- Détecter tout prospect ou opportunité commerciale mentionnée

Actions à déclencher :
- Si un suivi est mentionné → créer une tâche de rappel (automatique)
- Si un contact ou prospect est évoqué → log_activity ou create_contact dans RapidoCRM
- Toujours → send_recap aux participants

Format du rapport :
- Résumé en 2-3 phrases du contenu de l'appel
- Liste des tâches/action items avec assigné si possible
- Décisions prises, même si informelles
- Prospects/opportunités détectés
`,
    };

    for (const [filename, content] of Object.entries(defaults)) {
      const filePath = path.join(this.skillsDir, filename);
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`[SkillLoader] Created default skill: ${filename}`);
    }

    // Now load the files we just created
    this.loadAll();
  }
}

// Export a single instance — this is the pattern for all modules.
// Every other file that needs the skill registry imports this instance.
// There is only ever ONE SkillLoader in the entire application.
export const skillRegistry = new SkillLoader();