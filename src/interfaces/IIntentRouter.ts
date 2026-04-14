import { INLPOutput } from "./INLPOutput";
import { IAction } from "./IAction";

/**
 * C4 Component: Intent Router
 * File: src/router.ts
 *
 * The ONLY module allowed to call the AI model for routing decisions.
 * Takes extraction output → returns ordered list of actions to execute.
 */
export interface IIntentRouter {
  decide(
    extraction:   INLPOutput,  // What was found in the meeting
    sessionId:    string,      // For logging and tracing
    skillContent: string,       // Active Skill file may override routing rules
    userInstructions?: string       // Optional user instructions for routing
  ): Promise<IAction[]>;
}

// SECTION 6 — DISPATCHER (dispatcher.ts)
// Executes actions by calling N8N webhooks.

/**
 * Result of executing one action via N8N.
 */
