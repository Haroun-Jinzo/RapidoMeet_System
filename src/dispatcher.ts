// src/dispatcher.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: MCP Dispatcher
// Routes tools to:
//   - RapidoCRM MCP (OAuth Bearer per user) for crm_* tools
//   - RapidoCMS MCP (OAuth Bearer per user) for cms_* tools
//   - Rapido RH MCP (OAuth Bearer per user) for rh_* tools
//   - Local Supabase for db_save_task
//   - Google Calendar API for calendar_create_event
//   - n8n MCP hub for everything else (email, telegram, …)
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
import { isCmsTool } from "./config/cmsTools";
import { mapCmsMcpArguments, resolveCmsMcpToolName } from "./config/cmsMcpToolMap";
import { isRhTool } from "./config/rhTools";
import { mapRhMcpArguments, resolveRhMcpToolName } from "./config/rhMcpToolMap";
import { progressBus, actionProgressPercent } from "./progress/ProgressBus";
import { connectionsStore } from "./integrations/ConnectionsStore";
import { googleCalendarClient, GoogleCalendarEventParams } from "./integrations/GoogleCalendarClient";
import {
  getConfirmationPreferences,
  shouldSendTelegramConfirmation,
} from "./integrations/confirmationPreferences";
import { TELEGRAM_PROVIDER, getFrontendUrl } from "./auth/telegramConfig";
import {
  buildConfirmationMessage,
  sendTelegramMessage,
} from "./integrations/TelegramClient";
import { formatPendingAction } from "./utils/pendingActionFormatter";

export interface ExecuteAllContext {
  userId: string;
}

type OAuthMcpProvider = "crm" | "cms" | "rh";

class MCPDispatcher implements IMCPDispatcher {
  private n8nClients: Map<string, Client> = new Map();
  /** Cache key: `${provider}:${userId}:${mcpUrl}` */
  private oauthMcpClients: Map<string, Client> = new Map();

  invalidateCrmClient(userId: string): void {
    this.invalidateOAuthMcpClient("crm", userId);
  }

  invalidateCmsClient(userId: string): void {
    this.invalidateOAuthMcpClient("cms", userId);
  }

  invalidateRhClient(userId: string): void {
    this.invalidateOAuthMcpClient("rh", userId);
  }

  private invalidateOAuthMcpClient(provider: OAuthMcpProvider, userId: string): void {
    const prefix = `${provider}:${userId}:`;
    for (const key of this.oauthMcpClients.keys()) {
      if (key.startsWith(prefix)) {
        this.oauthMcpClients.delete(key);
      }
    }
  }

  private isDirectTool(tool: string): boolean {
    return (
      isCrmTool(tool) ||
      isCmsTool(tool) ||
      isRhTool(tool) ||
      tool === "db_save_task" ||
      tool === "telegram_send_confirmation" ||
      tool === "calendar_create_event"
    );
  }

  async execute(action: IAction, apiKeys?: APIKeys): Promise<IDispatchResult> {
    const maxRetries = 3;
    let lastError = "";
    let retryCount = 0;

    const n8nApiKey = apiKeys?.n8n || process.env.N8N_API_KEY;

    if (!this.isDirectTool(action.tool)) {
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

        if (this.isNonRetryableError(lastError)) {
          break;
        }

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

    const queuedPending: ReturnType<typeof formatPendingAction>[] = [];

    for (const criticalAction of critical) {
      console.log(
        `[Dispatcher] Critical action [${criticalAction.tool}] — saving to pending_actions`
      );

      const actionParams = { ...criticalAction.params };
      const userId = context?.userId;
      const pendingSummary = formatPendingAction(criticalAction);
      queuedPending.push(pendingSummary);

      if (isCrmTool(criticalAction.tool)) {
        const connected = userId
          ? await connectionsStore.hasActiveConnection(userId, "rapidocrm")
          : false;

        if (!connected) {
          console.error(
            `[Dispatcher] RapidoCRM OAuth not connected for ${criticalAction.id} ` +
              `(user ${userId ?? "unknown"}) — connect in Settings → Integrations`
          );
        }
      }

      if (isCmsTool(criticalAction.tool)) {
        const connected = userId
          ? await connectionsStore.hasActiveConnection(userId, "rapidocms")
          : false;

        if (!connected) {
          console.error(
            `[Dispatcher] RapidoCMS OAuth not connected for ${criticalAction.id} ` +
              `(user ${userId ?? "unknown"}) — connect in Settings → Integrations`
          );
        }
      }

      if (isRhTool(criticalAction.tool)) {
        const connected = userId
          ? await connectionsStore.hasActiveConnection(userId, "rapidorh")
          : false;

        if (!connected) {
          console.error(
            `[Dispatcher] Rapido RH OAuth not connected for ${criticalAction.id} ` +
              `(user ${userId ?? "unknown"}) — connect in Settings → Integrations`
          );
        }
      }

      if (criticalAction.tool === "calendar_create_event") {
        const connected = userId
          ? await connectionsStore.hasActiveConnection(userId, "google_calendar")
          : false;

        if (!connected) {
          console.error(
            `[Dispatcher] Google Calendar OAuth not connected for ${criticalAction.id} ` +
              `(user ${userId ?? "unknown"}) — connect in Settings → Integrations`
          );
        }
      }

      if (userId) {
        try {
          await memoryManager.savePendingAction({
            actionId: criticalAction.id,
            sessionId,
            userId,
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

      criticalAction.status = "pending";

      const prefs = userId
        ? await getConfirmationPreferences(userId)
        : { channel: "in_app" as const };
      const hasTelegram = userId
        ? await connectionsStore.hasActiveConnection(userId, TELEGRAM_PROVIDER)
        : false;
      const sendTelegram = userId
        ? shouldSendTelegramConfirmation(prefs, hasTelegram)
        : false;

      let telegramSent = false;
      let telegramError: string | undefined;

      if (sendTelegram && userId) {
        const telegram = await connectionsStore.getTelegramConnection(userId);
        if (telegram) {
          const details = JSON.stringify(actionParams, null, 2);
          const message = buildConfirmationMessage({
            actionTool: criticalAction.tool,
            actionId: criticalAction.id,
            sessionId,
            details,
            frontendUrl: getFrontendUrl(),
          });

          const tgResult = await sendTelegramMessage(
            { botToken: telegram.botToken, chatId: telegram.chatId },
            message
          );

          telegramSent = tgResult.success;
          telegramError = tgResult.error;

          results.push({
            actionId: `tg_alert_${criticalAction.id}`,
            success: tgResult.success,
            result: tgResult.success ? "Telegram confirmation sent" : undefined,
            error: tgResult.error,
            retries: 0,
          });
        } else {
          telegramError = "Telegram credentials missing — reconnect in Settings.";
        }
      }

      const inAppAvailable = prefs.channel !== "telegram";
      const confirmationReady = inAppAvailable || telegramSent;

      if (confirmationReady) {
        const detailParts = ["Approve in the RapidoMeet pipeline panel"];
        if (telegramSent) detailParts.unshift("Telegram notification sent");
        if (telegramError && sendTelegram) {
          detailParts.push(`Telegram: ${telegramError}`);
        }

        progressBus.emit({
          sessionId,
          step: "confirmation",
          state: "awaiting_confirmation",
          message: `Awaiting approval: ${criticalAction.tool.replace(/_/g, " ")}`,
          progress: actionProgressPercent(actionIndex, totalActions),
          detail: detailParts.join(" · "),
          pending_actions: [...queuedPending],
        });
      } else {
        emitActionProgress(
          criticalAction.tool,
          false,
          telegramError,
          telegramError || "No confirmation channel configured"
        );
      }

      actionIndex += 1;
    }

    if (queuedPending.length > 0) {
      progressBus.emit({
        sessionId,
        step: "confirmation",
        state: "awaiting_confirmation",
        message: `${queuedPending.length} action${queuedPending.length === 1 ? "" : "s"} waiting for your approval`,
        progress: actionProgressPercent(Math.max(actionIndex - 1, 0), totalActions),
        detail: queuedPending.map((a) => a.action_type || a.title).join(", "),
        pending_actions: [...queuedPending],
      });
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

  private async getOAuthMcpClient(
    provider: OAuthMcpProvider,
    userId: string,
    label: string,
    resolveConnection: () => Promise<{ accessToken: string; mcpUrl: string }>
  ): Promise<Client> {
    const { accessToken, mcpUrl } = await resolveConnection();
    const cacheKey = `${provider}:${userId}:${mcpUrl}`;

    const existing = this.oauthMcpClients.get(cacheKey);
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
      { name: `RapidoMeet${label}`, version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.oauthMcpClients.set(cacheKey, client);
    console.log(`[Dispatcher] Connected to ${label} MCP at ${mcpUrl} for user ${userId}`);

    return client;
  }

  private async getCrmClient(userId: string): Promise<Client> {
    return this.getOAuthMcpClient("crm", userId, "RapidoCRM", () =>
      connectionsStore.getCRMConnection(userId)
    );
  }

  private async getCmsClient(userId: string): Promise<Client> {
    return this.getOAuthMcpClient("cms", userId, "RapidoCMS", () =>
      connectionsStore.getCMSConnection(userId)
    );
  }

  private async getRhClient(userId: string): Promise<Client> {
    return this.getOAuthMcpClient("rh", userId, "RapidoRH", () =>
      connectionsStore.getRHConnection(userId)
    );
  }

  private isAuthError(error: unknown): boolean {
    const msg = (error as Error).message?.toLowerCase() ?? "";
    return msg.includes("401") || msg.includes("unauthorized") || msg.includes("authentication");
  }

  /** Permission / scope / validation errors won't succeed on retry — fail fast. */
  private isNonRetryableError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("insufficient") ||
      lower.includes("scope_insufficient") ||
      lower.includes("missing the calendar permission") ||
      lower.includes("not connected") ||
      lower.includes("sont requis") ||
      lower.includes("requires a company name") ||
      lower.includes("requires ") ||
      lower.includes("manquant")
    );
  }

  /** OAuth MCP tools may return HTTP 200 with JSON { success: false } in content text. */
  private assertMcpToolSucceeded(
    label: string,
    result: {
      content?: unknown;
      isError?: boolean;
    }
  ): void {
    if (result.isError) {
      throw new Error(`${label} tool returned isError=true`);
    }

    const items = Array.isArray(result.content) ? result.content : [];
    for (const item of items) {
      if (!item || typeof item !== "object" || !("text" in item)) continue;
      const text = String((item as { text: unknown }).text);
      try {
        const parsed = JSON.parse(text) as { success?: boolean; message?: string; error?: string };
        if (parsed.success === false) {
          throw new Error(
            parsed.message || parsed.error || `${label} tool reported success:false`
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

    if (action.tool === "telegram_send_confirmation") {
      const userId =
        (action.params.user_id as string | undefined) ||
        (action.params.userId as string | undefined);
      const message =
        (action.params.message as string | undefined) ||
        (action.params.action_description as string | undefined) ||
        "Action requires your approval.";

      if (userId) {
        const telegram = await connectionsStore.getTelegramConnection(userId);
        if (telegram) {
          const result = await sendTelegramMessage(
            { botToken: telegram.botToken, chatId: telegram.chatId },
            message
          );
          if (!result.success) {
            throw new Error(result.error || "Failed to send Telegram confirmation");
          }
          return {
            _mcpStatus: "success",
            tool: action.tool,
            content: [{ type: "text", text: "Telegram confirmation sent" }],
          };
        }
      }

      const envToken = process.env.TELEGRAM_BOT_TOKEN;
      const envChatId = process.env.TELEGRAM_CHAT_ID;
      if (envToken && envChatId) {
        const result = await sendTelegramMessage(
          { botToken: envToken, chatId: envChatId },
          message
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to send Telegram confirmation");
        }
        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: [{ type: "text", text: "Telegram confirmation sent (global bot)" }],
        };
      }

      throw new Error(
        "Telegram is not configured. Connect your bot in Settings → Integrations."
      );
    }

    if (action.tool === "calendar_create_event") {
      const userId = action.params.userId as string | undefined;
      if (!userId) {
        throw new Error("Missing userId on calendar action — cannot resolve OAuth token.");
      }

      try {
        const event = await googleCalendarClient.createEvent(userId, {
          ...(action.params as Record<string, unknown>),
        } as GoogleCalendarEventParams);

        const message = `Calendar event created: ${event.summary}${event.htmlLink ? ` — ${event.htmlLink}` : ""}`;

        console.log(`[Google Calendar] ${message}`);

        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: [{ type: "text", text: message }],
          event,
        };
      } catch (error) {
        throw new Error((error as Error).message);
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

        this.assertMcpToolSucceeded("CRM", result as { content?: unknown; isError?: boolean });

        console.log(`[Dispatcher] CRM MCP OK: ${action.tool} → ${mcpToolName}`);

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

    if (isCmsTool(action.tool)) {
      const userId = action.params.userId as string | undefined;
      if (!userId) {
        throw new Error("Missing userId on CMS action — cannot resolve OAuth token.");
      }

      const toolArgs = mapCmsMcpArguments(
        action.tool,
        action.params as Record<string, unknown>
      );
      const mcpToolName = resolveCmsMcpToolName(action.tool);

      try {
        const client = await this.getCmsClient(userId);
        const result = await client.callTool({
          name: mcpToolName,
          arguments: toolArgs,
        });

        this.assertMcpToolSucceeded("CMS", result as { content?: unknown; isError?: boolean });

        console.log(`[Dispatcher] CMS MCP OK: ${action.tool} → ${mcpToolName}`);

        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: result.content,
        } as Record<string, unknown>;
      } catch (error) {
        if (this.isAuthError(error)) {
          this.invalidateCmsClient(userId);
        }
        throw new Error(
          `CMS MCP tool ${action.tool} → ${mcpToolName} execution failed: ${(error as Error).message}`
        );
      }
    }

    if (isRhTool(action.tool)) {
      const userId = action.params.userId as string | undefined;
      if (!userId) {
        throw new Error("Missing userId on RH action — cannot resolve OAuth token.");
      }

      const toolArgs = mapRhMcpArguments(
        action.tool,
        action.params as Record<string, unknown>
      );
      const mcpToolName = resolveRhMcpToolName(action.tool);

      try {
        const client = await this.getRhClient(userId);
        const result = await client.callTool({
          name: mcpToolName,
          arguments: toolArgs,
        });

        this.assertMcpToolSucceeded("RH", result as { content?: unknown; isError?: boolean });

        console.log(`[Dispatcher] RH MCP OK: ${action.tool} → ${mcpToolName}`);

        return {
          _mcpStatus: "success",
          tool: action.tool,
          content: result.content,
        } as Record<string, unknown>;
      } catch (error) {
        if (this.isAuthError(error)) {
          this.invalidateRhClient(userId);
        }
        throw new Error(
          `RH MCP tool ${action.tool} → ${mcpToolName} execution failed: ${(error as Error).message}`
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
