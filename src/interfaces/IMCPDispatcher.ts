import { IAction } from "./IAction";
import { IDispatchResult } from "./IDispatchResult";

/**
 * C4 Component: MCP Dispatcher
 * File: src/dispatcher.ts
 *
 * The ONLY module allowed to call N8N webhooks.
 * Handles retry logic (max 3 attempts) and reports results.
 */
export interface IMCPDispatcher {
  /**
   * Execute one non-critical action immediately.
   * Used for: calendar events, email recaps, saving tasks.
   */
  execute(action: IAction, apiKeys?: any): Promise<IDispatchResult>;

  /**
   * Execute all non-critical actions in a session in order.
   * Skips any action where requiresConfirmation is true.
   */
  executeAll(
    actions:   IAction[],
    sessionId: string,
    apiKeys?:  any
  ): Promise<IDispatchResult[]>;

  /**
   * Resume a previously suspended critical action after Gate approval.
   * Called by index.ts when the user confirms via the UI or Telegram.
   */
  resume(
    action:    IAction,
    sessionId: string,
    apiKeys?:  any
  ): Promise<IDispatchResult>;
}

// SECTION 7 — MEMORY (memory.ts)
// Short-term cache (Redis) and long-term storage (PostgreSQL).

/**
 * A completed meeting stored permanently in PostgreSQL.
 * Created when a session reaches "complete" status.
 */
