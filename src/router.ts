import { z } from "zod";
import { nanoid } from "nanoid";
import {
  IIntentRouter,
  IAction,
  INLPOutput,
  MCPTool,
  ActionStatus,
} from "./interfaces";
import { CircuitBreaker } from "./resilience/CircuitBreaker";
import {
  requiresConfirmationForTool,
  CIRCUIT_BREAKER_CONFIG,
} from "./config/services";
import { generateLlmText } from "./utils/llmGenerate";
import { crmToolSortIndex } from "./config/crmTools";
import { isCmsTool } from "./config/cmsTools";
import { isRhTool } from "./config/rhTools";
import { ALL_MCP_TOOL_NAMES } from "./interfaces/MCPTool";

const MAX_LLM_ACTIONS = 8;
const ROUTER_MAX_TOKENS = 2048;

const ROUTABLE_TOOLS = ALL_MCP_TOOL_NAMES.filter(
  (t) => t !== "telegram_send_confirmation"
);

const knownRoutableTools = new Set<string>(ROUTABLE_TOOLS as unknown as string[]);

const LLM_FORBIDDEN_TOOLS = new Set([
  "db_save_task",
  "email_send_recap",
  "telegram_send_confirmation",
]);

function isRoutableToolName(tool: string): boolean {
  return (
    knownRoutableTools.has(tool) ||
    tool.startsWith("cms_") ||
    tool.startsWith("rh_") ||
    tool.startsWith("crm_")
  );
}

const ActionDecisionSchema = z.object({
  tool: z.string().refine(isRoutableToolName, { message: "Unknown MCP tool" }),
  params: z.record(z.string(), z.unknown()),
  requiresConfirmation: z.boolean(),
  reason: z.string(),
});

const RouterOutputSchema = z.object({
  actions: z.array(ActionDecisionSchema).max(MAX_LLM_ACTIONS),
  summary: z.string(),
});

function hasCalendarSchedule(params: Record<string, unknown>): boolean {
  const hasDateTime = (value: unknown): boolean =>
    typeof value === "string"
      ? value.trim().length > 0
      : typeof value === "object" &&
          value !== null &&
          typeof (value as { dateTime?: unknown }).dateTime === "string" &&
          Boolean((value as { dateTime: string }).dateTime.trim());
  const hasStartAndEnd = hasDateTime(params.start) && hasDateTime(params.end);
  const hasDateAndTime = Boolean(
    typeof params.date === "string" &&
      params.date.trim() &&
      ((typeof params.time === "string" && params.time.trim()) ||
        (typeof params.start_time === "string" && params.start_time.trim()))
  );
  return hasStartAndEnd || hasDateAndTime;
}

function extractEmails(...texts: string[]): string[] {
  const joined = texts.join(" ");
  return Array.from(
    new Set(joined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
  );
}

class IntentRouter implements IIntentRouter {
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = new CircuitBreaker("gemini-router", CIRCUIT_BREAKER_CONFIG);
    console.log("[IntentRouter] Gemini client initialised with circuit breaker protection");
  }

  async decide(
    extraction: INLPOutput,
    sessionId: string,
    skillContent: string,
    userInstructions?: string,
    apiKeys?: any
  ): Promise<IAction[]> {
    const provider = apiKeys?.Orchestrator?.provider || "gemini";
    const apiKey = apiKeys?.Orchestrator?.apiKey || process.env.GEMINI_API_KEY;

    console.log(
      `[IntentRouter] Deciding actions for session ${sessionId} using ${String(provider).toUpperCase()} — ` +
        `tasks: ${extraction.tasks.length}, ` +
        `prospects: ${extraction.prospects.length}, ` +
        `decisions: ${extraction.decisions.length}`
    );

    const startTime = Date.now();
    const deterministic = this.buildDeterministicActions(extraction, userInstructions);

    try {
      const llmDecisions = await this.routeWithLlm(
        extraction,
        skillContent,
        userInstructions,
        provider,
        apiKey
      );

      const llmOnly = {
        ...llmDecisions,
        actions: llmDecisions.actions
          .filter((a) => !LLM_FORBIDDEN_TOOLS.has(a.tool))
          .slice(0, MAX_LLM_ACTIONS),
      };

      const llmActions = this.buildActions(llmOnly);
      const actions = this.sortActions([...deterministic, ...llmActions]);

      actions.forEach((a, index) => {
        const flag = a.requiresConfirmation ? "🔒 [REQUIRES CONFIRMATION]" : "✓ [AUTO-EXEC]";
        const params = JSON.stringify(a.params).substring(0, 60) + "...";
        console.log(`  ${index + 1}. ${flag} ${a.tool} — ${params}`);
      });

      console.log(
        `[IntentRouter] Decision complete — ` +
          `${actions.length} total (${deterministic.length} deterministic, ${llmActions.length} from LLM), ` +
          `${actions.filter((a) => a.requiresConfirmation).length} require confirmation, ` +
          `elapsed: ${Date.now() - startTime}ms`
      );

      return actions;
    } catch (error) {
      const message = (error as Error).message;
      console.error("[IntentRouter] Routing failed:", message);

      // Soft fallback: still return tasks/email so the pipeline is useful
      if (deterministic.length > 0) {
        console.warn(
          `[IntentRouter] Falling back to ${deterministic.length} deterministic action(s) only`
        );
        return this.sortActions(deterministic);
      }

      throw new Error(`Intent routing failed: ${message}`);
    }
  }

  private buildDeterministicActions(
    extraction: INLPOutput,
    userInstructions?: string
  ): IAction[] {
    const actions: IAction[] = [];

    for (const task of extraction.tasks) {
      if (!task.title?.trim()) continue;
      actions.push({
        id: `action_${nanoid(8)}`,
        tool: "db_save_task",
        params: {
          title: task.title.trim(),
          assignee: task.assignee || undefined,
          deadline: task.deadline || undefined,
          priority: task.priority || "medium",
          source: task.source || undefined,
        },
        requiresConfirmation: false,
        status: "pending" as ActionStatus,
      });
    }

    const emails = extractEmails(
      userInstructions || "",
      extraction.summary || "",
      ...extraction.prospects.map((p) => p.email || ""),
      ...extraction.tasks.map((t) => t.assignee || "")
    );

    const subject = "RapidoMeet — Meeting Recap";
    const body = extraction.summary || "Meeting recap is ready.";

    if (emails.length > 0) {
      for (const addr of emails) {
        actions.push({
          id: `action_${nanoid(8)}`,
          tool: "email_send_recap",
          params: {
            target_email: addr,
            participants: emails,
            subject,
            message_body: body,
          },
          requiresConfirmation: false,
          status: "pending" as ActionStatus,
        });
      }
    } else {
      actions.push({
        id: `action_${nanoid(8)}`,
        tool: "email_send_recap",
        params: {
          target_email: "admin@example.com",
          subject,
          message_body: body,
        },
        requiresConfirmation: false,
        status: "pending" as ActionStatus,
      });
    }

    return actions;
  }

  private async routeWithLlm(
    extraction: INLPOutput,
    skillContent: string,
    userInstructions: string | undefined,
    provider: string,
    apiKey: string
  ): Promise<z.infer<typeof RouterOutputSchema>> {
    const systemPrompt = this.buildSystemPrompt(userInstructions);
    const userPrompt = this.buildUserPrompt(extraction, skillContent, userInstructions);

    const callOnce = async (sys: string, usr: string) => {
      const executeGenAI = async () =>
        generateLlmText({
          provider,
          apiKey,
          systemPrompt: sys,
          userPrompt: usr,
          temperature: 0.0,
          maxTokens: ROUTER_MAX_TOKENS,
        });

      return Promise.race([
        this.circuitBreaker.execute(executeGenAI),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`${provider} routing timeout (60s)`)), 60_000)
        ),
      ]);
    };

    let rawText = await callOnce(systemPrompt, userPrompt);

    try {
      return this.parseAndValidate(rawText);
    } catch (firstErr) {
      console.warn(
        `[IntentRouter] First parse failed (${(firstErr as Error).message}). Retrying with compact prompt…`
      );

      const compactUser =
        userPrompt +
        `\n\nIMPORTANT: Previous output was truncated or invalid. ` +
        `Return a SHORTER JSON with at most ${Math.min(MAX_LLM_ACTIONS, 5)} actions. ` +
        `No db_save_task, no email_send_recap. Minimal params only.`;

      rawText = await callOnce(systemPrompt, compactUser);
      return this.parseAndValidate(rawText);
    }
  }

  private buildSystemPrompt(userInstructions?: string): string {
    return `
You are the action router for RapidoMeet.

Tasks and email recap are already handled in code — DO NOT emit db_save_task or email_send_recap.

Your job: propose at most ${MAX_LLM_ACTIONS} HIGH-VALUE integrations from the meeting.
User Instructions: ${userInstructions ? userInstructions : "None"}

## Tools you MAY use (compact list)

CRM (require confirmation for create/update/delete):
- crm_create_contact, crm_create_enterprise, crm_create_opportunity, crm_log_activity
- crm_create_invoice, crm_create_quote, crm_create_contract (only if explicitly discussed)
- crm_read_* only if needed to complete another action

Calendar:
- calendar_create_event (confirmation required) — only if a future meeting/call is scheduled
  - Emit it only when the extraction contains an exact date and time.
  - Required params: summary (or title) plus either start and end ISO 8601 datetimes,
    or date + time. Optional duration_minutes defaults to 60.
  - Use date format YYYY-MM-DD and 24-hour time format HH:mm (for example,
    date "2026-10-24", time "11:00"). Do not use natural-language dates.
  - Never emit calendar_create_event with empty params or without scheduling fields.

CMS (only if social posts / campaigns / digital cards are clearly discussed; max 2):
- cms_create_draft_tool, cms_create_campagne, cms_add_digital_card, cms_schedule_draft_tool

RH (only if leave/employees/HR is clearly discussed; max 2):
- rh_create_leave, rh_create_employee, rh_update_employee, rh_log_action

Optional: n8n_trigger_workflow (only if user instructions demand a custom workflow)

## Rules
1. Max ${MAX_LLM_ACTIONS} actions. Prefer quality over quantity.
2. One crm_create_contact (or enterprise) per NEW prospect with enough data.
3. No vague actions. Keep params short (no long notes).
4. requiresConfirmation true for all writes / calendar; false for crm_log_activity / reads.
5. Return ONLY a valid JSON object (no markdown).

Output shape:
{"actions":[{"tool":"crm_create_contact","params":{"first_name":"...","email":"..."},"requiresConfirmation":true,"reason":"..."}],"summary":"one short sentence"}
`.trim();
  }

  private buildUserPrompt(
    extraction: INLPOutput,
    skillContent: string,
    userInstructions?: string
  ): string {
    const skillSnippet =
      skillContent.length > 800 ? skillContent.slice(0, 800) + "…" : skillContent;

    // Cap lists in the prompt so the model stays focused
    const tasks = extraction.tasks.slice(0, 15);
    const decisions = extraction.decisions.slice(0, 10);
    const prospects = extraction.prospects.slice(0, 10);

    return `
## Skill (excerpt)
${skillSnippet}

## Extra User Instructions
${userInstructions ? userInstructions : "None"}

## Extraction
Summary: ${extraction.summary}
Sentiment: ${extraction.sentiment}
Skill: ${extraction.skillUsed}

### Tasks (${extraction.tasks.length} total, showing ${tasks.length}) — already saved in code, do NOT emit db_save_task
${
  tasks
    .map(
      (t, i) =>
        `${i + 1}. "${t.title}" — ${t.assignee || "unassigned"}, ${t.deadline || "no deadline"}, ${t.priority}`
    )
    .join("\n") || "None"
}

### Decisions (${extraction.decisions.length})
${
  decisions.map((d, i) => `${i + 1}. "${d.text}" — ${d.owner || "unknown"}`).join("\n") ||
  "None"
}

### Prospects (${extraction.prospects.length})
${
  prospects
    .map(
      (p, i) =>
        `${i + 1}. ${p.company}${p.contact ? ` — ${p.contact}` : ""}${p.email ? ` (${p.email})` : ""} — ${p.score}`
    )
    .join("\n") || "None"
}

Return ONLY JSON: {"actions":[...max ${MAX_LLM_ACTIONS}...],"summary":"..."}
`.trim();
  }

  private parseAndValidate(rawText: string): z.infer<typeof RouterOutputSchema> {
    let parsed: unknown;

    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      parsed = JSON.parse(cleaned);
    } catch {
      const salvaged = this.trySalvageTruncatedJson(rawText);
      if (!salvaged) {
        throw new Error(
          `[IntentRouter] Gemini returned invalid JSON. ` +
            `First 200 chars: ${rawText.substring(0, 200)}`
        );
      }
      parsed = salvaged;
      console.warn("[IntentRouter] Salvaged truncated JSON into partial actions");
    }

    const result = RouterOutputSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      console.error("[IntentRouter] Validation errors:", errors);
      throw new Error(`[IntentRouter] Response validation failed: ${errors}`);
    }

    return result.data;
  }

  private trySalvageTruncatedJson(rawText: string): unknown | null {
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const actionsMatch = cleaned.match(/"actions"\s*:\s*\[/);
    if (!actionsMatch || actionsMatch.index === undefined) return null;

    const start = actionsMatch.index + actionsMatch[0].length;
    const slice = cleaned.slice(start);

    const objects: unknown[] = [];
    let depth = 0;
    let objStart = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const chunk = slice.slice(objStart, i + 1);
          try {
            objects.push(JSON.parse(chunk));
          } catch {
            /* skip incomplete */
          }
          objStart = -1;
        }
      } else if (ch === "]" && depth === 0) {
        break;
      }
    }

    if (objects.length === 0) return null;

    const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      actions: objects.slice(0, MAX_LLM_ACTIONS),
      summary: summaryMatch?.[1] || "Partial routing (truncated model output)",
    };
  }

  private buildActions(output: z.infer<typeof RouterOutputSchema>): IAction[] {
    return output.actions
      .filter((decision) => {
        if (decision.tool === "calendar_create_event" && !hasCalendarSchedule(decision.params)) {
          console.warn(
            "[IntentRouter] Ignoring calendar_create_event without start/end or date/time parameters"
          );
          return false;
        }
        return true;
      })
      .map((decision) => {
        const requiresConfirmation = requiresConfirmationForTool(
          decision.tool,
          decision.requiresConfirmation
        );

        return {
          id: `action_${nanoid(8)}`,
          tool: decision.tool as MCPTool,
          params: decision.params,
          requiresConfirmation,
          status: "pending" as ActionStatus,
        };
      });
  }

  private sortActions(actions: IAction[]): IAction[] {
    const nonCrmOrder: MCPTool[] = [
      "calendar_create_event",
      "n8n_trigger_workflow",
      "db_save_task",
      "email_send_recap",
    ];

    return [...actions].sort((a, b) => {
      const sortIndex = (tool: string): number => {
        if (tool.startsWith("crm_")) return crmToolSortIndex(tool);
        if (isCmsTool(tool)) return 300 + (tool.includes("list_") || tool.includes("get_") ? 0 : 10);
        if (isRhTool(tool)) return 400 + (tool.includes("list_") || tool.includes("get_") ? 0 : 10);
        const idx = nonCrmOrder.indexOf(tool as MCPTool);
        return idx === -1 ? 900 : 500 + idx;
      };
      return sortIndex(a.tool) - sortIndex(b.tool);
    });
  }
}

export const intentRouter = new IntentRouter();
