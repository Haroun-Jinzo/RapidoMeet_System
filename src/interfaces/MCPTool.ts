/**
 * All possible MCP tool calls the dispatcher can execute.
 * These map directly to N8N webhook paths.
 */
export type MCPTool =
  | "crm_create_contact"      // Creates a contact in RapidoCRM
  | "crm_create_opportunity"  // Creates a sales opportunity
  | "crm_log_activity"        // Logs meeting notes on existing contact
  | "calendar_create_event"   // Creates Google Calendar event
  | "email_send_recap"        // Sends HTML recap email to participants
  | "db_save_task"            // Saves a task to PostgreSQL
  | "n8n_trigger_workflow";   // Triggers a custom N8N workflow by name

/**
 * One atomic action the dispatcher will execute.
 *
 * The requiresConfirmation flag is the Confirmation Gate trigger.
 * When true: pipeline pauses, user is notified, must approve before dispatch.
 * When false: dispatcher executes immediately, no human needed.
 */
