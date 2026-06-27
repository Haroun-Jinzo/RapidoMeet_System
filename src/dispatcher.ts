// src/dispatcher.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: MCP Dispatcher
// Routes tools to:
//   - RapidoCRM MCP (OAuth Bearer per user) for crm_* tools
//   - Local Supabase for db_save_task
//   - n8n MCP hub for everything else (calendar, email, telegram, …)
// ─────────────────────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  IMCPDispatcher,
  IAction,
  IDispatchResult,
} from "./interfaces";
import { memoryManager } from "./memory";
import { APIKeys } from "./utils/KeyResolver";
import { isCrmTool } from "./config/crmTools";
import { mapCrmMcpArguments, resolveCrmMcpToolName } from "./config/crmMcpToolMap";
import { progressBus, actionProgressPercent } from "./progress/ProgressBus";
import { connectionsStore } from "./integrations/ConnectionsStore";

export interface ExecuteAllContext {
  userId: string;
}

class MCPDispatcher implements IMCPDispatcher {
  private n8nClients: Map<string, Client> = new Map();
  /** Cache key: `${userId}:${mcpUrl}` */
  private crmClients: Map<string, Client> = new Map();

  invalidateCrmClient(userId: string): void {
    for (const key of this.crmClients.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.crmClients.delete(key);
      }
    }
  }

  async execute(action: IAction, apiKeys?: APIKeys): Promise<IDispatchResult> {
    const maxRetries = 3;
    let lastError = "";
    let retryCount = 0;

    const n8nApiKey = apiKeys?.n8n || process.env.N8N_API_KEY;

    if (!isCrmTool(action.tool) && action.tool !== "db_save_task") {
      if (!this.n8nClients.has(n8nApiKey as string)) {
        await this.initN8nClient(n8nApiKey as string);
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callMCPTool(action, n8nApiKey as string);

        action.status = "executed";
        action.result = JSON.stringify(result);

        console.log(`[Dispatcher] ✓ ${action.tool} — attempt ${attempt}/${maxRetries}`);

        return {
          actionId: action.id,
          success: true,
          result: JSON.stringify(result),
          retries: attempt - 1,
        };
      } catch (error) {
        lastError = (error as Error).message;
        retryCount = attempt;

        console.warn(
          `[Dispatcher] Attempt ${attempt}/${maxRetries} failed for ${action.tool}: ${lastError}`
        );

        if (attempt < maxRetries) {
          const waitMs = Math.pow(2, attempt) * 1000;
          console.log(`[Dispatcher] Waiting ${waitMs}ms before retry...`);
          await this.sleep(waitMs);
        }
      }
    }

    action.status = "pending";

    console.error(
      `[Dispatcher] ✗ ${action.tool} failed after ${maxRetries} attempts: ${lastError}`
    );

    return {
      actionId: action.id,
      success: false,
      error: `Failed after ${maxRetries} attempts: ${lastError}`,
      retries: retryCount,
    };
  }

  async executeAll(
    actions: IAction[],
    sessionId: string,
    apiKeys?: APIKeys,
    context?: ExecuteAllContext
  ): Promise<IDispatchResult[]> {
    const results: IDispatchResult[] = [];

    const nonCritical = actions.filter((a) => !a.requiresConfirmation);
    const critical = actions.filter((a) => a.requiresConfirmation);

    console.log(
      `[Dispatcher] Session ${sessionId} — executing ${nonCritical.length} auto actions, ${critical.length} pending confirmation`
    );

    const totalActions = actions.length;
    let actionIndex = 0;

    const emitActionProgress = (
      tool: string,
      success: boolean,
      detail?: string,
      error?: string
    ) => {
      progressBus.emit({
        sessionId,
        step: "action",
        message: success
          ? `Completed: ${tool.replace(/_/g, " ")}`
          : `Failed: ${tool.replace(/_/g, " ")}`,
        progress: actionProgressPercent(actionIndex, totalActions),
        detail,
        error,
      });
      actionIndex += 1;
    };

    for (const action of nonCritical) {
      console.log(`[Dispatcher] Executing: ${action.tool}`);
      const result = await this.execute(action, apiKeys);
      results.push(result);

      emitActionProgress(
        action.tool,
        result.success,
        result.success ? undefined : result.error,
        result.success ? undefined : result.error
      );

      if (!result.success) {
        console.error(
          `[Dispatcher] Action ${action.tool} failed — continuing with remaining actions`
        );
      }
    }

    for (const criticalAction of critical) {
      console.log(
        `[Dispatcher] Critical action [${criticalAction.tool}] — saving to pending_actions and notifying via Telegram`
      );

      const actionParams = { ...criticalAction.params };

      if (isCrmTool(criticalAction.tool)) {
        const connected = context?.userId
          ? await connectionsStore.hasActiveConnection(context.userId, "rapidocrm")
          : false;

        if (!connected) {
          console.error(
            `[Dispatcher] RapidoCRM OAuth not connected for ${criticalAction.id} ` +
              `(user ${context?.userId ?? "unknown"}) — connect in Settings → Integrations`
          );
        }
      }

      if (context?.userId) {
        try {
          await memoryManager.savePendingAction({
            actionId: criticalAction.id,
            sessionId,
            userId: context.userId,
            actionTool: criticalAction.tool,
            params: actionParams,
            status: "pending",
          });
        } catch (err) {
          console.error(
            `[Dispatcher] Failed to save pending action ${criticalAction.id}:`,
            (err as Error).message
          );
        }
      } else {
        console.warn(
          `[Dispatcher] No userId in context — pending_actions row not saved for ${criticalAction.id}`
        );
      }

      const details = JSON.stringify(actionParams, null, 2);
      const approvalMessage =
        `🚨 *Requires Approval*\n\nAction: ${criticalAction.tool}\n\nDetails:\n${details}`;

      const telegramAction: IAction = {
        id: `tg_alert_${criticalAction.id}`,
        tool: "telegram_send_confirmation",
        params: {
          session_id: sessionId,
          action_id: criticalAction.id,
          user_id: context?.userId,
          action_type: criticalAction.tool,
          action_tool: criticalAction.tool,
          action_params: actionParams,
          action_description: details,
          payload: {
            action_id: criticalAction.id,
            session_id: sessionId,
            params: actionParams,
            message: approvalMessage,
          },
          message: approvalMessage,
        },
        requiresConfirmation: false,
        status: "pending",
      };

      const tgResult = await this.execute(telegramAction, apiKeys);
      results.push(tgResult);

      if (tgResult.success) {
        progressBus.emit({
          sessionId,
          step: "confirmation",
          message: `Awaiting approval: ${criticalAction.tool.replace(/_/g, " ")}`,
          progress: actionProgressPercent(actionIndex, totalActions),
          detail: "Approve via Telegram or the app to execute this action",
        });
        criticalAction.status = "pending";
      } else {
        emitActionProgress(
          criticalAction.tool,
          false,
          tgResult.error,
          tgResult.error
        );
      }
      actionIndex += 1;
    }

    return results;
  }

  async resume(
    action: IAction,
    sessionId: string,
    apiKeys?: APIKeys
  ): Promise<IDispatchResult> {
    if (action.status === "refused" || action.status === "timeout") {
      return {
        actionId: action.id,
        success: false,
        error: `Action was ${action.status} by user`,
        retries: 0,
      };
    }

    if (action.status !== "confirmed") {
      throw new Error(
        `[Dispatcher] Cannot resume action ${action.id} — status is "${action.status}", expected "confirmed"`
      );
    }

    return this.execute(action, apiKeys);
  }

  private async initN8nClient(n8nApiKey?: string) {
    const url = process.env.MCP_N8N_URL;

    if (!url) {
      console.warn("[Dispatcher] Missing MCP_N8N_URL in environment variables.");
      return;
    }

    try {
      const apiKey = n8nApiKey || process.env.N8N_API_KEY;
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { "X-N8N-API-KEY": apiKey } },
      });
      const client = new Client(
        { name: "RapidoMeetOrchestrator", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);
      this.n8nClients.set(apiKey as string, client);
      console.log(`[Dispatcher] Connected to N8N MCP server at ${url}`);
    } catch (err) {
      console.warn(
        `[Dispatcher] Failed to connect to N8N MCP server: ${(err as Error).message}`
      );
    }
  }

  private async getCrmClient(userId: string): Promise<Client> {
    const { accessToken, mcpUrl } = await connectionsStore.getCRMConnection(userId);
    const cacheKey = `${userId}:${mcpUrl}`;

    const existing = this.crmClients.get(cacheKey);
    if (existing) {
      return existing;
    }

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const client = new Client(
      { name: "RapidoMeetCRM", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.crmClients.set(cacheKey, client);
    console.log(`[Dispatcher] Connected to RapidoCRM MCP at ${mcpUrl} for user ${userId}`);

    return client;
  }

  private isAuthError(error: unknown): boolean {
    const msg = (error as Error).message?.toLowerCase() ?? "";
    return msg.includes("401") || msg.includes("unauthorized") || msg.includes("authentication");
  }

  /** RapidoCRM tools may return HTTP 200 with JSON { success: false } in content text. */
  private assertCrmToolSucceeded(result: {
    content?: unknown;
    isError?: boolean;
  }): void {
    if (result.isError) {
      throw new Error("CRM tool returned isError=true");
    }

    const items = Array.isArray(result.content) ? result.content : [];
    for (const item of items) {
      if (!item || typeof item !== "object" || !("text" in item)) continue;
      const text = String((item as { text: unknown }).text);
      try {
        const parsed = JSON.parse(text) as { success?: boolean; message?: string; error?: string };
        if (parsed.success === false) {
          throw new Error(
            parsed.message || parsed.error || "CRM tool reported success:false"
          );
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }

  private async callMCPTool(
    action: IAction,
    n8nApiKey?: string
  ): Promise<Record<string, unknown>> {
    if (action.tool === "db_save_task") {
      try {
        console.log("[Dispatcher] Intercepted db_save_task: Routing directly to local Supabase");

        const id = await memoryManager.saveTask({
          title: action.params.title as string,
          assignee: (action.params.assignee as string) || undefined,
          deadline: (action.params.deadline as string) || undefined,
          priority: action.params.priority as "high" | "medium" | "low",
          source: (action.params.source as string) || "System Generated",
          sessionId: (action.params.sessionId as string) || "unknown_session",
          userId: (action.params.userId as string) || "00000000-0000-0000-0000-000000000000",
        });
        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: [{ type: "text", text: `Task safely written to DB with ID ${id}` }],
        };
      } catch (error) {
        throw new Error(`Failed to save task in local memory: ${(error as Error).message}`);
      }
    }

    if (isCrmTool(action.tool)) {
      const userId = action.params.userId as string | undefined;
      if (!userId) {
        throw new Error("Missing userId on CRM action — cannot resolve OAuth token.");
      }

      const toolArgs = mapCrmMcpArguments(
        action.tool,
        action.params as Record<string, unknown>
      );
      const mcpToolName = resolveCrmMcpToolName(action.tool);

      try {
        const client = await this.getCrmClient(userId);
        const result = await client.callTool({
          name: mcpToolName,
          arguments: toolArgs,
        });

        this.assertCrmToolSucceeded(result as { content?: unknown; isError?: boolean });

        console.log(
          `[CRM MCP RESPONSE for ${action.tool} → ${mcpToolName}]:`,
          JSON.stringify(result, null, 2)
        );

        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: result.content,
        } as Record<string, unknown>;
      } catch (error) {
        if (this.isAuthError(error)) {
          this.invalidateCrmClient(userId);
        }
        throw new Error(
          `CRM MCP tool ${action.tool} → ${mcpToolName} execution failed: ${(error as Error).message}`
        );
      }
    }

    const apiKey = n8nApiKey || process.env.N8N_API_KEY;
    const client = this.n8nClients.get(apiKey as string);

    if (!client) {
      throw new Error("MCP Client for n8n is not connected.");
    }

    try {
      const result = await client.callTool({
        name: action.tool,
        arguments: action.params as Record<string, unknown>,
      });

      console.log(`[N8N RESPONSE for ${action.tool}]:`, JSON.stringify(result, null, 2));

      return {
        _mcpStatus: "success",
        tool: action.tool,
        content: result.content,
      } as Record<string, unknown>;
    } catch (error) {
      throw new Error(`MCP tool ${action.tool} execution failed: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const mcpDispatcher = new MCPDispatcher();
