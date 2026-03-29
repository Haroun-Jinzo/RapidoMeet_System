// src/dispatcher.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: MCP Dispatcher
// Interface:  IMCPDispatcher (from interfaces.ts)
// Responsibility: Execute IAction objects by calling N8N webhooks.
//                 Implements retry logic (max 3 attempts, exponential backoff).
//                 The ONLY module that calls N8N webhooks.
// Dependencies: N8N_WEBHOOK_BASE_URL, N8N_API_KEY environment variables.
// ─────────────────────────────────────────────────────────────────────────────

import {
  IMCPDispatcher,
  IAction,
  IDispatchResult,
  MCPTool,
} from "./interfaces";

// ── N8N webhook path mapping ──────────────────────────────────────────────────
// Maps each MCPTool enum value to its N8N webhook path.
// When N8N is set up, each path corresponds to one workflow.
//
// Format: POST {N8N_WEBHOOK_BASE_URL}/webhook/{path}

const WEBHOOK_PATHS: Record<MCPTool, string> = {
  "crm.create_contact":     "rapidomeet-crm-contact",
  "crm.create_opportunity": "rapidomeet-crm-opportunity",
  "crm.log_activity":       "rapidomeet-crm-activity",
  "calendar.create_event":  "rapidomeet-calendar-event",
  "email.send_recap":       "rapidomeet-email-recap",
  "db.save_task":           "rapidomeet-task-save",
  "n8n.trigger_workflow":   "rapidomeet-custom-workflow",
};

// ── Mock responses for testing without N8N ───────────────────────────────────
// When N8N_READY = false, the dispatcher returns these fake responses.
// Each response is realistic enough to test the full pipeline end to end.
// Flip N8N_READY = true the moment Michael gives you N8N access.

const MOCK_RESPONSES: Record<MCPTool, Record<string, unknown>> = {
  "crm.create_contact":     { contact_id: `crm_${Date.now()}`,       status: "created" },
  "crm.create_opportunity": { opportunity_id: `opp_${Date.now()}`,   status: "created" },
  "crm.log_activity":       { activity_id: `act_${Date.now()}`,      status: "logged"  },
  "calendar.create_event":  { event_id: `evt_${Date.now()}`,         event_link: "https://calendar.google.com/event?eid=mock", status: "created" },
  "email.send_recap":       { sent_to: [],                            status: "delivered" },
  "db.save_task":           { task_id: `task_${Date.now()}`,         status: "saved" },
  "n8n.trigger_workflow":   { execution_id: `exec_${Date.now()}`,    status: "triggered" },
};

// ─────────────────────────────────────────────────────────────────────────────

class MCPDispatcher implements IMCPDispatcher {

  // ── Flip this to true when N8N webhooks are configured ──────────────────────
  // This is the ONLY line you change when N8N becomes available.
  private N8N_READY = false;

  // ── execute ────────────────────────────────────────────────────────────────
  // Executes one action with up to 3 retry attempts.
  // Uses exponential backoff: wait 1s, then 2s, then 4s between retries.
  //
  // Exponential backoff explanation:
  //   If N8N is temporarily overloaded, hammering it every 100ms makes things
  //   worse. Waiting longer between each retry gives it time to recover.

  async execute(action: IAction): Promise<IDispatchResult> {
    const maxRetries  = 3;
    let   lastError   = "";
    let   retryCount  = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callWebhook(action);

        // Success — update action status and return
        action.status = "executed";
        action.result = JSON.stringify(result);

        console.log(
          `[Dispatcher] ✓ ${action.tool} — ` +
          `attempt ${attempt}/${maxRetries}`
        );

        return {
          actionId: action.id,
          success:  true,
          result:   JSON.stringify(result),
          retries:  attempt - 1,
        };

      } catch (error) {
        lastError  = (error as Error).message;
        retryCount = attempt;

        console.warn(
          `[Dispatcher] Attempt ${attempt}/${maxRetries} failed for ` +
          `${action.tool}: ${lastError}`
        );

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s (increased for longer API calls)
          const waitMs = Math.pow(2, attempt) * 1000;
          console.log(`[Dispatcher] Waiting ${waitMs}ms before retry...`);
          await this.sleep(waitMs);
        }
      }
    }

    // All retries exhausted — mark as failed
    action.status = "pending"; // remains pending — not executed

    console.error(
      `[Dispatcher] ✗ ${action.tool} failed after ${maxRetries} attempts: ${lastError}`
    );

    return {
      actionId: action.id,
      success:  false,
      error:    `Failed after ${maxRetries} attempts: ${lastError}`,
      retries:  retryCount,
    };
  }

  // ── executeAll ─────────────────────────────────────────────────────────────
  // Executes all non-critical actions in order.
  // Skips any action where requiresConfirmation is true —
  // those are handled by the Confirmation Gate in index.ts.
  //
  // Uses sequential execution (one at a time) rather than parallel
  // because some actions depend on previous ones.
  // Example: you cannot log_activity on a contact before creating it.

  async executeAll(
    actions:   IAction[],
    sessionId: string
  ): Promise<IDispatchResult[]> {
    const results: IDispatchResult[] = [];

    // Split actions into two groups
    const nonCritical = actions.filter(a => !a.requiresConfirmation);
    const critical    = actions.filter(a =>  a.requiresConfirmation);

    console.log(
      `[Dispatcher] Session ${sessionId} — ` +
      `executing ${nonCritical.length} auto actions, ` +
      `${critical.length} pending confirmation`
    );

    // Execute non-critical actions immediately
    for (const action of nonCritical) {
      console.log(`[Dispatcher] Executing: ${action.tool}`);
      const result = await this.execute(action);
      results.push(result);

      // If an action fails, log it but continue with the rest.
      // We don't abort the whole pipeline for one failure.
      if (!result.success) {
        console.error(
          `[Dispatcher] Action ${action.tool} failed — ` +
          `continuing with remaining actions`
        );
      }
    }

    // Critical actions are NOT executed here.
    // They stay with status "pending" until resume() is called.
    // The caller (index.ts) is responsible for:
    //   1. Detecting which actions are still pending
    //   2. Triggering the Confirmation Gate notification
    //   3. Calling resume() after user approval

    return results;
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  // Executes a single critical action after the user has confirmed it.
  // Called by index.ts when the user approves via the UI or Telegram.
  //
  // The action must have status "confirmed" before calling this.
  // If it has status "refused" or "timeout", we do not execute.

  async resume(
    action:    IAction,
    sessionId: string
  ): Promise<IDispatchResult> {
    if (action.status === "refused" || action.status === "timeout") {
      console.log(
        `[Dispatcher] Skipping ${action.tool} — ` +
        `status is ${action.status}`
      );
      return {
        actionId: action.id,
        success:  false,
        error:    `Action was ${action.status} by user`,
        retries:  0,
      };
    }

    if (action.status !== "confirmed") {
      throw new Error(
        `[Dispatcher] Cannot resume action ${action.id} — ` +
        `status is "${action.status}", expected "confirmed"`
      );
    }

    console.log(
      `[Dispatcher] Resuming confirmed action: ` +
      `${action.tool} (session: ${sessionId})`
    );

    return this.execute(action);
  }

  // ── PRIVATE: callWebhook ───────────────────────────────────────────────────
  // The actual HTTP call to N8N.
  // In mock mode, returns a fake response immediately.
  // In live mode, calls the real N8N webhook URL.

  private async callWebhook(
    action: IAction
  ): Promise<Record<string, unknown>> {

    // ── MOCK MODE ──────────────────────────────────────────────────────────
    if (!this.N8N_READY) {
      console.log(
        `[Dispatcher] 🟡 MOCK — ${action.tool}`,
        JSON.stringify(action.params, null, 2)
      );

      // Simulate network delay (100-300ms) so tests feel realistic
      await this.sleep(100 + Math.random() * 200);

      // Return mock response, replacing any dynamic IDs
      const mock = { ...MOCK_RESPONSES[action.tool] };

      // For email recap, include the actual participants from params
      if (action.tool === "email.send_recap" && action.params.participants) {
        mock.sent_to = action.params.participants;
      }

      return mock;
    }
    // ── END MOCK MODE ──────────────────────────────────────────────────────

    // ── LIVE MODE — real N8N webhook call ──────────────────────────────────
    const baseUrl     = process.env.N8N_WEBHOOK_BASE_URL;
    const apiKey      = process.env.N8N_API_KEY;
    const webhookPath = WEBHOOK_PATHS[action.tool];

    if (!baseUrl) {
      throw new Error("N8N_WEBHOOK_BASE_URL is not set in environment variables");
    }

    const url = `${baseUrl}/webhook/${webhookPath}`;

    const response = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-Webhook-Auth":  apiKey || "",
        // Send session context so N8N can log which meeting triggered this
        "X-Session-Id":    action.id,
      },
      body: JSON.stringify({
        ...action.params,
        _action_id:  action.id,
        _tool:       action.tool,
      }),
      // 2 minute timeout — N8N may need time to call external APIs and services
      // Some integrations (CRM, Calendar, Email) require 30-60 seconds
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "no body");
      throw new Error(
        `N8N webhook ${webhookPath} returned ${response.status}: ${errorBody}`
      );
    }

    // N8N always returns JSON — if it doesn't, something is wrong
    const result = await response.json().catch(() => {
      throw new Error(`N8N returned non-JSON response for ${webhookPath}`);
    }) as Record<string, unknown>;

    return result;
  }

  // ── PRIVATE: sleep ─────────────────────────────────────────────────────────
  // Simple promise-based delay for retry backoff.

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export a single shared instance
export const mcpDispatcher = new MCPDispatcher();