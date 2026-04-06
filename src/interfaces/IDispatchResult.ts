import { IAction } from "./IAction";

/**
 * Result of executing one action via N8N.
 */
export interface IDispatchResult {
  actionId:  string;   // Matches IAction.id
  success:   boolean;
  result?:   string;   // What N8N returned on success
  error?:    string;   // Error message on failure
  retries:   number;   // How many times we retried (max 3)
}

/**
 * C4 Component: MCP Dispatcher
 * File: src/dispatcher.ts
 *
 * The ONLY module allowed to call N8N webhooks.
 * Handles retry logic (max 3 attempts) and reports results.
 */
