// src/dispatcher.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: MCP Dispatcher
// Interface:  IMCPDispatcher (from interfaces.ts)
// Responsibility: Execute IAction objects by calling external MCP servers.
//                 Implements retry logic (max 3 attempts, exponential backoff).
//                 Uses @modelcontextprotocol/sdk to call tools directly.
//                 Connects to 5 distinct MCP domain servers.
// ─────────────────────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  IMCPDispatcher,
  IAction,
  IDispatchResult
} from "./interfaces";
import { memoryManager } from "./memory";

// ─────────────────────────────────────────────────────────────────────────────

class MCPDispatcher implements IMCPDispatcher {

  // A generic Map storing our active MCP Client(s). 
  // Map<K, V> is a TypeScript collection where keys are strings and values are Client instances.
  private mcpClients: Map<string, Client> = new Map();

  // ── execute ────────────────────────────────────────────────────────────────
  // Executes one action with up to 3 retry attempts.
  // Uses exponential backoff: wait 1s, then 2s, then 4s between retries.

  //
  // Exponential backoff explanation:
  //   If MCP tools are temporarily overloaded, hammering it every 100ms makes things
  //   worse. Waiting longer between each retry gives it time to recover.

  async execute(action: IAction, apiKeys?: any): Promise<IDispatchResult> {
    const maxRetries  = 3;
    let   lastError   = "";
    let   retryCount  = 0;

    const n8nApiKey = apiKeys?.n8n || process.env.N8N_API_KEY;

    // Ensure clients are connected before executing
    if (!this.mcpClients.has(n8nApiKey as string)) {
      await this.initClients(n8nApiKey as string);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callMCPTool(action, n8nApiKey as string);

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
    sessionId: string,
    apiKeys?:  any
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

    // TEMPORARY TEST TO PROVE N8N CONNECTION
    /*const TestAction :IAction =  {
    id: "test_action_123",
    tool: "email_send_recap", 
    params: { 
      target_email: "harounkhmiri247@gmail.com", 
      subject: "N8N Connection Test",
      message_body: "Did n8n receive this?" 
    },
    requiresConfirmation: false,
    status: "pending"
    };
    nonCritical.push(TestAction);*/

    // Execute non-critical actions immediately
    for (const action of nonCritical) {
      console.log(`[Dispatcher] Executing: ${action.tool}`);
      const result = await this.execute(action, apiKeys);
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
    
    for (const criticalAction of critical) {
      console.log(`[Dispatcher] Found critical action [${criticalAction.tool}]. Triggering N8N Telegram Bot...`);

      //format the specific parameters for this action so the user knows what they are approving
      const details = JSON.stringify(criticalAction.params, null, 2);

      //create a synthetic action to trigger the N8N Telegram workflow
      const telegramAction: IAction = {
        id: `tg_alert_${Date.now()}`,
        tool: "telegram_send_confirmation", //This MUST match your N8N MCP Tool name exactly
        params: {
          session_id: sessionId,
          action_id: criticalAction.id, // IMPORTANT: Send the specific Action ID to N8N
          action_tool: criticalAction.tool,
          action_description: details,
          message: `🚨 *Requires Approval*\n\nAction: ${criticalAction.tool}\n\nDetails:\n${details}`
        },
        requiresConfirmation: false,
        status: "pending"
      }

      const tgResult = await this.execute(telegramAction, apiKeys);
      results.push(tgResult);
    }

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
    sessionId: string,
    apiKeys?:  any
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

    return this.execute(action, apiKeys);
  }

  // ── PRIVATE: initialize MCP Clients ────────────────────────────────────────
  // Configures the connection to our central n8n MCP server hub.
  private async initClients(n8nApiKey?: string) {
    const url = process.env.MCP_N8N_URL;

    if (!url) {
      console.warn("[Dispatcher] Missing MCP_N8N_URL in environment variables.");
      return;
    }

    try {
      const apiKey = n8nApiKey || process.env.N8N_API_KEY;
      const transport = new StreamableHTTPClientTransport(new URL(url), {requestInit: { headers: {"X-N8N-API-KEY": apiKey}}});
      const client = new Client(
        { name: "RapidoMeetOrchestrator", version: "1.0.0" },
        { capabilities: {} }
      );

      // Note: Await connection resolution through Server-Sent Events (SSE)
      await client.connect(transport);
      this.mcpClients.set(apiKey as string, client);
      console.log(`[Dispatcher] Connected to N8N MCP server at ${url}`);
    } catch (err) {
      // Type assertion "(err as Error).message" allows us to safely extract error text natively in TS
      console.warn(`[Dispatcher] Failed to connect to N8N MCP server: ${(err as Error).message}`);
    }
  }

  // ── PRIVATE: callMCPTool ───────────────────────────────────────────────────
  // The actual JSON-RPC call to the proper MCP server via the SDK.
  // INTERCEPTS 'db_save_task' to execute directly against local Supabase.
  
  private async callMCPTool(
    action: IAction,
    n8nApiKey?: string
  ): Promise<Record<string, unknown>> {
    // 1. INTERCEPT LOCAL TASKS (Scalability optimization)
    if (action.tool === "db_save_task") {
      try {
        console.log(`[Dispatcher] Intercepted db_save_task: Routing directly to local Supabase`);

        // Ensure params perfectly matches the expected ITask shape in memory.ts
        const id = await memoryManager.saveTask({
          title: action.params.title as string,
          assignee: (action.params.assignee as string) || undefined,
          deadline: (action.params.deadline as string) || undefined,
          priority: action.params.priority as "high" | "medium" | "low",
          source: (action.params.source as string) || "System Generated",
          sessionId: action.params.sessionId as string || "unknown_session",
          userId: action.params.userId as string || "00000000-0000-0000-0000-000000000000"
      });
      return { _mcpStatus: "success", tool: action.tool, content: [{ type: "text", text: `Task safely written to DB with ID ${id}` }] };
    } catch (error) {
      throw new Error(`Failed to save task in local memory: ${(error as Error).message}`);
    }
  }

    // ── LIVE MODE — real MCP Tool call ──────────────────────────────────
    // Every AI action, whether 'email', 'calendar', or 'crm', resolves to n8n.
    const apiKey = n8nApiKey || process.env.N8N_API_KEY;
    const client = this.mcpClients.get(apiKey as string);

    if (!client) {
      throw new Error(`MCP Client for n8n is not connected.`);
    }
    
    try {
      // Execute true MCP Tool call via standardized JSON-RPC
      // Record<string, unknown> specifies an object with string keys and safely-typed arbitrary values.
      const result = await client.callTool({
        name: action.tool,
        arguments: action.params as Record<string, unknown>
      });

      // 🚨 LOG EXACTLY WHAT N8N SAYS BACK 🚨
      console.log(`[N8N RESPONSE for ${action.tool}]:`, JSON.stringify(result, null, 2));

      // Based on MCP standard, result contains the executable layout payloadss.
      const content = result.content;
      return { _mcpStatus: "success", tool: action.tool, content } as Record<string, unknown>;
    } catch (error) {
      throw new Error(`MCP tool ${action.tool} execution failed: ${(error as Error).message}`);
    }
  }

  // ── PRIVATE: sleep ─────────────────────────────────────────────────────────
  // Simple promise-based delay for retry backoff.

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export a single shared instance
export const mcpDispatcher = new MCPDispatcher();