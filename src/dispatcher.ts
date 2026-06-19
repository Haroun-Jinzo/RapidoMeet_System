// src/dispatcher.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: MCP Dispatcher
// Interface:  IMCPDispatcher (from interfaces.ts)
// Responsibility: Execute IAction objects by calling external MCP servers.
//                 Implements retry logic (max 3 attempts, exponential backoff).
//                 Uses @modelcontextprotocol/sdk to call tools directly.
//                 Connects to the central n8n MCP hub (single MCP URL).
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
import { isCrmTool, getCrmRouteConfig } from "./config/crmTools";
import { progressBus, actionProgressPercent } from "./progress/ProgressBus";

function enrichCrmParams(
  params: Record<string, unknown>,
  apiKeys?: APIKeys
): Record<string, unknown> {
  const crm = apiKeys?.rapidoCRM;
  if (!crm?.apiKey) return params;
  return {
    ...params,
    rapidocrm_api_key: crm.apiKey,
    api_url: crm.apiUrl ?? params.api_url,
  };
}

export interface ExecuteAllContext {
  userId: string;
}

// ─────────────────────────────────────────────────────────────────────────────

class MCPDispatcher implements IMCPDispatcher {

  private mcpClients: Map<string, Client> = new Map();

  async execute(action: IAction, apiKeys?: APIKeys): Promise<IDispatchResult> {
    const maxRetries  = 3;
    let   lastError   = "";
    let   retryCount  = 0;

    const n8nApiKey = apiKeys?.n8n || process.env.N8N_API_KEY;

    if (!this.mcpClients.has(n8nApiKey as string)) {
      await this.initClients(n8nApiKey as string);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.callMCPTool(action, n8nApiKey as string, apiKeys);

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
      success:  false,
      error:    `Failed after ${maxRetries} attempts: ${lastError}`,
      retries:  retryCount,
    };
  }

  async executeAll(
    actions:   IAction[],
    sessionId: string,
    apiKeys?:  APIKeys,
    context?:  ExecuteAllContext
  ): Promise<IDispatchResult[]> {
    const results: IDispatchResult[] = [];

    const nonCritical = actions.filter(a => !a.requiresConfirmation);
    const critical    = actions.filter(a =>  a.requiresConfirmation);

    console.log(
      `[Dispatcher] Session ${sessionId} — ` +
      `executing ${nonCritical.length} auto actions, ` +
      `${critical.length} pending confirmation`
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
          `[Dispatcher] Action ${action.tool} failed — ` +
          `continuing with remaining actions`
        );
      }
    }

    // Critical actions are executed by n8n after Telegram approval.
    // We persist them to pending_actions and notify via telegram_send_confirmation.
    for (const criticalAction of critical) {
      console.log(
        `[Dispatcher] Critical action [${criticalAction.tool}] — ` +
        `saving to pending_actions and notifying via Telegram`
      );

      // Enrich params for n8n post-approval execution (CRM credentials + api URL).
      let actionParams = { ...criticalAction.params };
      if (isCrmTool(criticalAction.tool)) {
        const crm = apiKeys?.rapidoCRM;
        if (!crm?.apiKey) {
          console.error(
            `[Dispatcher] RapidoCRM not connected for ${criticalAction.id} ` +
            `(user ${context?.userId ?? "unknown"}) — n8n execution will fail without api key`
          );
        } else {
          actionParams = enrichCrmParams(actionParams, apiKeys);
          const route = getCrmRouteConfig(criticalAction.tool);
          if (route) {
            actionParams = { ...actionParams, _crm_route: route };
          }
        }
      }

      if (context?.userId) {
        try {
          await memoryManager.savePendingAction({
            actionId:   criticalAction.id,
            sessionId,
            userId:     context.userId,
            actionTool: criticalAction.tool,
            params:     actionParams,
            status:     "pending",
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
          session_id:         sessionId,
          action_id:          criticalAction.id,
          user_id:            context?.userId,
          action_type:        criticalAction.tool,
          action_tool:        criticalAction.tool,
          action_params:      actionParams,
          action_description: details,
          payload: {
            action_id:  criticalAction.id,
            session_id: sessionId,
            params:     actionParams,
            message:    approvalMessage,
          },
          message: approvalMessage,
        },
        requiresConfirmation: false,
        status: "pending",
      };

      const tgResult = await this.execute(telegramAction, apiKeys);
      results.push(tgResult);

      emitActionProgress(
        criticalAction.tool,
        tgResult.success,
        tgResult.success
          ? "Awaiting your approval via Telegram"
          : tgResult.error,
        tgResult.success ? undefined : tgResult.error
      );

      if (tgResult.success) {
        criticalAction.status = "pending";
      }
    }

    return results;
  }

  /**
   * @deprecated Critical CRM actions are executed by n8n after Telegram approval.
   * Kept for backwards compatibility; prefer /internal/openclaw/session-update callbacks.
   */
  async resume(
    action:    IAction,
    sessionId: string,
    apiKeys?:  APIKeys
  ): Promise<IDispatchResult> {
    console.warn(
      `[Dispatcher] resume() called for ${action.tool} — ` +
      `critical actions should be executed by n8n approval workflows`
    );

    if (action.status === "refused" || action.status === "timeout") {
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

    return this.execute(action, apiKeys);
  }

  private async initClients(n8nApiKey?: string) {
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
      this.mcpClients.set(apiKey as string, client);
      console.log(`[Dispatcher] Connected to N8N MCP server at ${url}`);
    } catch (err) {
      console.warn(`[Dispatcher] Failed to connect to N8N MCP server: ${(err as Error).message}`);
    }
  }

  private async callMCPTool(
    action: IAction,
    n8nApiKey?: string,
    apiKeys?: APIKeys
  ): Promise<Record<string, unknown>> {

    if (isCrmTool(action.tool)) {
      const crm = apiKeys?.rapidoCRM;

      if (!crm?.apiKey) {
        throw new Error(
          `RapidoCRM is not connected for this user. ` +
          `They need to go to Settings → Integrations and connect their CRM account.`
        );
      }

      action.params = enrichCrmParams(action.params as Record<string, unknown>, apiKeys);
    }

    if (action.tool === "db_save_task") {
      try {
        console.log(`[Dispatcher] Intercepted db_save_task: Routing directly to local Supabase`);

        const id = await memoryManager.saveTask({
          title: action.params.title as string,
          assignee: (action.params.assignee as string) || undefined,
          deadline: (action.params.deadline as string) || undefined,
          priority: action.params.priority as "high" | "medium" | "low",
          source: (action.params.source as string) || "System Generated",
          sessionId: action.params.sessionId as string || "unknown_session",
          userId: action.params.userId as string || "00000000-0000-0000-0000-000000000000",
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

    const apiKey = n8nApiKey || process.env.N8N_API_KEY;
    const client = this.mcpClients.get(apiKey as string);

    if (!client) {
      throw new Error(`MCP Client for n8n is not connected.`);
    }

    try {
      const result = await client.callTool({
        name: action.tool,
        arguments: action.params as Record<string, unknown>,
      });

      console.log(`[N8N RESPONSE for ${action.tool}]:`, JSON.stringify(result, null, 2));

      const content = result.content;
      return { _mcpStatus: "success", tool: action.tool, content } as Record<string, unknown>;
    } catch (error) {
      throw new Error(`MCP tool ${action.tool} execution failed: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const mcpDispatcher = new MCPDispatcher();
