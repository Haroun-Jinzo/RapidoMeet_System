import { ITask } from "./ITask";
import { IDecision } from "./IDecision";
import { IProspect } from "./IProspect";

/**
 * The complete structured output of NLP analysis on a transcript.
 * This is what extract.ts produces and router.ts consumes.
 */
export interface INLPOutput {
  summary:   string;                        // 2-3 sentence meeting summary
  sentiment: "positive" | "neutral" | "negative";
  tasks:     ITask[];
  decisions: IDecision[];
  prospects: IProspect[];
  skillUsed: string;  // Name of the .md file that was active: "commercial"
}

/**
 * C4 Component: NLP Extractor
 * File: src/extract.ts
 *
 * The ONLY module allowed to call the AI model for extraction.
 * Takes a transcript + Skill content → returns structured INLPOutput.
 */
