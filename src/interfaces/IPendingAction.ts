import { MCPTool } from "./MCPTool";



export type PendingActionStatus =
  | "pending"
  | "approved"
  | "refused"
  | "executed"
  | "failed";

export interface IPendingAction {

  id?:          string;
  action_id:    string;
  session_id:   string;
  user_id:      string;
  action_tool:  MCPTool | string;
  params:       Record<string, unknown>;
  status:       PendingActionStatus;
  created_at?:  string;

}

export interface IPendingActionInsert {
  actionId:   string;
  sessionId:  string;
  userId:     string;
  actionTool: MCPTool | string;
  params:     Record<string, unknown>;
  status?:    PendingActionStatus;

}


