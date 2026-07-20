import { ALL_CRM_TOOL_NAMES } from "../config/crmTools";
import { ALL_CMS_TOOL_NAMES } from "../config/cmsTools";
import { ALL_RH_TOOL_NAMES } from "../config/rhTools";

/** Non-CRM/CMS/RH MCP tools */
export const NON_CRM_MCP_TOOLS = [
  "calendar_create_event",
  "email_send_recap",
  "db_save_task",
  "n8n_trigger_workflow",
  "telegram_send_confirmation",
] as const;

export type NonCrmMcpTool = (typeof NON_CRM_MCP_TOOLS)[number];

/**
 * All possible MCP tool calls the dispatcher can execute.
 * CRM: crm_* — CMS: cms_* — RH: rh_*
 */
export type MCPTool =
  | (typeof ALL_CRM_TOOL_NAMES)[number]
  | (typeof ALL_CMS_TOOL_NAMES)[number]
  | (typeof ALL_RH_TOOL_NAMES)[number]
  | NonCrmMcpTool
  | string;

export const ALL_MCP_TOOL_NAMES = [
  ...ALL_CRM_TOOL_NAMES,
  ...ALL_CMS_TOOL_NAMES,
  ...ALL_RH_TOOL_NAMES,
  ...NON_CRM_MCP_TOOLS,
] as const;

/**
 * One atomic action the dispatcher will execute.
 *
 * The requiresConfirmation flag is the Confirmation Gate trigger.
 * When true: pipeline pauses, user is notified, must approve before dispatch.
 * When false: dispatcher executes immediately, no human needed.
 */
