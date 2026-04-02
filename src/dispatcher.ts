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
  IDispatchResult,
  MCPTool,
} from "./interfaces";

// ── Mock responses for testing without actual MCP servers running ────────────
const MOCK_RESPONSES: Record<MCPTool, Record<string, unknown>> = {
  "crm_create_contact":     { contact_id: `crm_${Date.now()}`,       status: "created" },
  "crm_create_opportunity": { opportunity_id: `opp_${Date.now()}`,   status: "created" },
  "crm_log_activity":       { activity_id: `act_${Date.now()}`,      status: "logged"  },
  "calendar_create_event":  { event_id: `evt_${Date.now()}`,         event_link: "https://calendar.google.com/event?eid=mock", status: "created" },
  "email_send_recap":       { sent_to: [],                            status: "delivered" },
  "db_save_task":           { task_id: `task_${Date.now()}`,         status: "saved" },
  "n8n_trigger_workflow":   { execution_id: `exec_${Date.now()}`,    status: "triggered" },
};

// ─────────────────────────────────────────────────────────────────────────────

class MCPDispatcher implements IMCPDispatcher {

  // Map of domain to an active MCP Client (managing the 5 distinct servers)
  private mcpClients: Map<string, Client> = new Map();
  
  // ── Flip this to true when MCP servers are ready ───────────────────────────
  private MCP_READY = false;

  // ── execute ────────────────────────────────────────────────────────────────
  // Executes one action with up to 3 retry attempts.
  // Uses exponential backoff: wait 1s, then 2s, then 4s between retries.

  //
  // Exponential backoff explanation:
  //   If MCP tools are temporarily overloaded, hammering it every 100ms makes things
  //   worse. Waiting longer between each retry gives it time to recover.

  async execute(action: IAction): Promise<IDispatchResult> {
    const maxRetries  = 3;
    let   lastError   = "";
    let   retryCount  = 0;

    // Ensure clients are connected before executing
    if (this.MCP_READY && this.mcpClients.size === 0) {
      await this.initClients();
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callMCPTool(action);

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

  // ── PRIVATE: initialize MCP Clients ────────────────────────────────────────
  // Configures connections to the 5 MCP servers specified in the architecture.
  private async initClients() {
    const servers = {
      crm:      process.env.MCP_CRM_URL      || "http://localhost:3001/sse",
      calendar: process.env.MCP_CALENDAR_URL || "http://localhost:3002/sse",
      email:    process.env.MCP_EMAIL_URL    || "http://localhost:3003/sse",
      n8n:      process.env.MCP_N8N_URL      || "http://localhost:3004/sse",
      files:    process.env.MCP_FILES_URL    || "http://localhost:3005/sse",
    };

    for (const [domain, url] of Object.entries(servers)) {
      try {
        const transport = new StreamableHTTPClientTransport(new URL(url));
        const client = new Client(
          { name: "RapidoMeetOrchestrator", version: "1.0.0" }, 
          { capabilities: {} }
        );
        
        // Note: In production you may await connect lazily or continuously retry
        await client.connect(transport);
        this.mcpClients.set(domain, client);
        console.log(`[Dispatcher] Connected to ${domain.toUpperCase()} MCP server at ${url}`);
      } catch (err) {
        console.warn(`[Dispatcher] Failed to connect to ${domain.toUpperCase()} MCP server: ${(err as Error).message}`);
      }
    }
  }

  // ── PRIVATE: determineDomain ───────────────────────────────────────────────
  // Maps an MCPTool string to its respective Domain client.
  private getDomainForTool(tool: string): string {
    if (tool.startsWith("crm.")) return "crm";
    if (tool.startsWith("calendar.")) return "calendar";
    if (tool.startsWith("email.")) return "email";
    if (tool.startsWith("db.")) return "files"; // routing DB tasks to files/data MCP
    if (tool.startsWith("n8n.")) return "n8n";
    return "n8n"; // Default fallback
  }

  // ── PRIVATE: callMCPTool ───────────────────────────────────────────────────
  // The actual JSON-RPC call to the proper MCP server via the SDK.
  // In mock mode, returns a fake response immediately.

  private async callMCPTool(
    action: IAction
  ): Promise<Record<string, unknown>> {

    // ── MOCK MODE ──────────────────────────────────────────────────────────
    if (!this.MCP_READY) {
      console.log(
        `[Dispatcher] 🟡 MOCK — ${action.tool}`,
        JSON.stringify(action.params, null, 2)
      );

      // Simulate network delay (100-300ms) so tests feel realistic
      await this.sleep(100 + Math.random() * 200);

      // Return mock response, replacing any dynamic IDs
      const mock = { ...MOCK_RESPONSES[action.tool] };

      // For email recap, include the actual participants from params
      if (action.tool === "email_send_recap" && action.params.participants) {
        mock.sent_to = action.params.participants;
      }

      return mock;
    }
    // ── END MOCK MODE ──────────────────────────────────────────────────────

    // ── LIVE MODE — real MCP Tool call ──────────────────────────────────
    const domain = this.getDomainForTool(action.tool);
    const client = this.mcpClients.get(domain);
    
    if (!client) {
      throw new Error(`MCP Client for domain "${domain}" is not connected.`);
    }
    
    try {
      // Execute true MCP Tool call via standardized JSON-RPC over SSE
      const result = await client.callTool({
        name: action.tool,
        arguments: action.params as Record<string, unknown>
      });

      // Based on MCP standard, result has { content: [...] }
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