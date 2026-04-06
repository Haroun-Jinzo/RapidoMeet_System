import { ActionStatus } from "./ActionStatus";
import { MCPTool } from "./MCPTool";

/**
 * One atomic action the dispatcher will execute.
 *
 * The requiresConfirmation flag is the Confirmation Gate trigger.
 * When true: pipeline pauses, user is notified, must approve before dispatch.
 * When false: dispatcher executes immediately, no human needed.
 */
export interface IAction {
  id:                   string;                   // "action_001", "action_002"
  tool:                 MCPTool;                  // Which MCP tool to call
  params:               Record<string, unknown>;  // Arguments for the tool
  requiresConfirmation: boolean;                  // true = Confirmation Gate
  status:               ActionStatus;             // Current state
  result?:              string;                   // Filled after execution
  execution_status?:    string;                   // Detailed openclaw final status ('completed', 'failed', 'running')
  execution_result?:    any;                      // Output captured from OpenClaw pipeline
  updated_at?:          string;                   // Last execution update time
}

/**
 * C4 Component: Intent Router
 * File: src/router.ts
 *
 * The ONLY module allowed to call the AI model for routing decisions.
 * Takes extraction output → returns ordered list of actions to execute.
 */
