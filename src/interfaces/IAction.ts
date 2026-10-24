import { ActionStatus } from "./ActionStatus";
import { MCPTool } from "./MCPTool";

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
