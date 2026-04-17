/**
 * Intent Routing Service using Google Gemini
 * 
 * This service converts NLP extraction output into executable MCP tool actions.
 * It implements the Confirmation Gate pattern:
 * - CRITICAL actions (CRM writes) require user approval
 * - SAFE actions (email, logging) execute automatically
 * 
 * Dependencies: Google Gemini 2.0 Flash API, centralized service configuration
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z }                  from "zod";
import { nanoid }             from "nanoid";
import {
  IIntentRouter,
  IAction,
  INLPOutput,
  MCPTool,
  ActionStatus,
} from "./interfaces";
import { CircuitBreaker } from "./resilience/CircuitBreaker";
import {
  ALWAYS_CRITICAL_TOOLS,
  NEVER_CRITICAL_TOOLS,
  GEMINI_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
} from "./config/services";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const ActionDecisionSchema = z.object({
  tool: z.enum([
    "crm_create_contact",
    "crm_create_opportunity",
    "crm_log_activity",
    "calendar_create_event",
    "email_send_recap",
    "db_save_task",
    "n8n_trigger_workflow",
  ] as const),
  params:               z.record(z.string(), z.unknown()),
  requiresConfirmation: z.boolean(),
  reason:               z.string(),
});

const RouterOutputSchema = z.object({
  actions: z.array(ActionDecisionSchema),
  summary: z.string(),
});

// ============================================================================
// Intent Router Class
// ============================================================================

class IntentRouter implements IIntentRouter {
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = new CircuitBreaker('gemini-router', CIRCUIT_BREAKER_CONFIG);
    console.log("[IntentRouter] Gemini client initialised with circuit breaker protection");
  }

  /**
   * Convert NLP extraction data into ordered MCP tool actions
   * 
   * Execution flow:
   * 1. Build prompt with extraction data and Skill instructions
   * 2. Call Gemini API via circuit breaker
   * 3. Parse JSON and validate with Zod schemas
   * 4. Enforce confirmation gate rules (critical vs. safe)
   * 5. Sort actions by priority (CRM first, email last)
   * 6. Return ordered action list for dispatcher
   * 
   * @param extraction - NLP extraction output
   * @param sessionId - Session ID for logging
   * @param skillContent - Active Skill instructions
   * @returns Ordered list of actions ready for dispatcher
   */
  async decide(
    extraction:   INLPOutput,
    sessionId:    string,
    skillContent: string,
    userInstructions?: string,
    apiKeys?: any
  ): Promise<IAction[]> {
    const apiKey = apiKeys?.gemini || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API key not configured");
    const genAI = new GoogleGenerativeAI(apiKey);

    console.log(
      `[IntentRouter] Deciding actions for session ${sessionId} — ` +
      `tasks: ${extraction.tasks.length}, ` +
      `prospects: ${extraction.prospects.length}, ` +
      `decisions: ${extraction.decisions.length}`
    );

    const startTime = Date.now();

    // Configure Gemini for deterministic routing
    const model = genAI.getGenerativeModel({
      model: GEMINI_CONFIG.model,
      systemInstruction: this.buildSystemPrompt(userInstructions),
      generationConfig: {
        responseMimeType: "application/json",
        temperature:      0.0, // Zero creativity — routing must be deterministic
        maxOutputTokens:  2048,
      },
    });

    const userPrompt = this.buildUserPrompt(extraction, skillContent, userInstructions);

    try {
      // Execute within circuit breaker protection with timeout
      // Timeout: 60 seconds to prevent indefinite hanging
      const result = await Promise.race([
        this.circuitBreaker.execute(async () => {
          return await model.generateContent(userPrompt);
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Gemini routing timeout (60s)')), 60_000)
        )
      ]) as any;

      const rawText = result.response.text();
      const elapsed = Date.now() - startTime;

      // Parse and validate Gemini's decision
      const decisions = this.parseAndValidate(rawText);

      // WORKAROUND: Programmatically extract email from all text to guarantee it's set
      const allTextContext = `${userInstructions || ""} ${JSON.stringify(extraction)}`;
      const emailMatch = allTextContext.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      
      let emailAction = decisions.actions.find(a => a.tool === "email_send_recap");
      
      // Force creation if Gemini forgot the action completely
      if (!emailAction) {
        emailAction = {
          tool: "email_send_recap",
          params: {
            target_email: "admin@example.com",
            subject: "Meeting Recap",
            message_body: decisions.summary || "Meeting recap is ready."
          },
          requiresConfirmation: false,
          reason: "Fallback created by router"
        };
        decisions.actions.push(emailAction);
      }

      // Overwrite the destination email if we found an email address in any of the texts
      if (emailMatch) {
        emailAction.params.target_email = emailMatch[0];
      }

      // Convert decisions to IAction objects with enforced confirmation rules
      const actions = this.buildActions(decisions);

      // Log the final decision list
      actions.forEach((a, index) => {
        const flag = a.requiresConfirmation ? "🔒 [REQUIRES CONFIRMATION]" : "✓ [AUTO-EXEC]";
        const params = JSON.stringify(a.params).substring(0, 60) + "...";
        console.log(`  ${index + 1}. ${flag} ${a.tool} — ${params}`);
      });

      console.log(
        `[IntentRouter] Decision complete — ` +
        `${actions.length} total actions, ` +
        `${actions.filter(a => a.requiresConfirmation).length} require confirmation, ` +
        `elapsed: ${elapsed}ms`
      );

      return actions;

    } catch (error) {
      const message = (error as Error).message;
      console.error("[IntentRouter] Routing failed:", message);
      throw new Error(`Intent routing failed: ${message}`);
    }
  }

  /**
   * Build system prompt defining Gemini's routing role
   * @returns System prompt string
   */
  private buildSystemPrompt(userInstructions?: string): string { 
    return `
You are the action router for RapidoMeet, an AI meeting assistant.

Your job is to analyse meeting extraction data and decide which MCP (Model Context Protocol) actions to execute.
User Instructions: ${userInstructions ? `Apply these instructions strictly! If an email address is mentioned here, you MUST use it as the "target_email" for the email_send_recap tool. Also modify the "message_body" based on these instructions: ${userInstructions}` : "None"}

## Available MCP Tools

| Tool | What it does | Risk level |
|------|-------------|------------|
| crm_create_contact | Creates a new permanent contact in RapidoCRM | HIGH — irreversible |
| crm_create_opportunity | Creates a sales opportunity in RapidoCRM | HIGH — irreversible |
| crm_log_activity | Logs a note on an existing CRM contact | LOW — append only |
| calendar_create_event | Creates a Google Calendar event | LOW — easily deleted |
| email_send_recap | Sends the meeting recap email to participants | LOW — informational |
| db_save_task | Saves an action item to the task database | LOW — easily deleted |
| n8n_trigger_workflow | Triggers a custom N8N automation workflow | MEDIUM — depends on workflow |

## Confirmation Gate Rules

requiresConfirmation MUST be true for ALWAYS_CRITICAL tools:
- crm_create_contact (permanent CRM record — irreversible)
- crm_create_opportunity (financial pipeline entry — irreversible)

requiresConfirmation MUST be false for NEVER_CRITICAL tools:
- email_send_recap (always send automatically)
- db_save_task (always save automatically)
- crm_log_activity (append only, safe)

## Decision Rules

1. Create one db_save_task for each task in extraction
2. Create one crm_create_contact for each new prospect
3. Create calendar_create_event if a task or decision mentions scheduling a meeting, a call, or an event in the future.
4. Always create email_send_recap at end (last action). For "target_email", you MUST extract the actual email address provided by the user in the Instructions above. If no email is found, or if instructions are empty, fallback to "admin@example.com". NEVER output null or placeholder text.
5. In your Output Format, replace all example values (like "user@example.com" or "Thomas") with the real data extracted from the meeting and instructions.
5. Only create crm_log_activity if CRM contact exists
6. Don't create actions for vague/uncertain information
7. Keep params concise — only use explicit information

Return ONLY valid JSON object.
`.trim();
  }

  /**
   * Build user prompt with extraction data
   * @returns User prompt string
   */
  private buildUserPrompt(
    extraction:   INLPOutput,
    skillContent: string,
    userInstructions?: string
  ): string {
    return `
## Active Skill Instructions
${skillContent}

## Extra User Instructions
${userInstructions ? userInstructions : "None"}

## Meeting Extraction Data
Summary: ${extraction.summary}
Sentiment: ${extraction.sentiment}
Skill: ${extraction.skillUsed}

### Tasks (${extraction.tasks.length})
${extraction.tasks.map((t, i) =>
  `${i + 1}. "${t.title}" — assigned to: ${t.assignee || "unassigned"}, deadline: ${t.deadline || "none"}, priority: ${t.priority}`
).join("\n") || "None"}

### Decisions (${extraction.decisions.length})
${extraction.decisions.map((d, i) =>
  `${i + 1}. "${d.text}" — owner: ${d.owner || "unknown"}`
).join("\n") || "None"}

### Prospects (${extraction.prospects.length})
${extraction.prospects.map((p, i) =>
  `${i + 1}. ${p.company}${p.contact ? ` — ${p.contact}` : ""}${p.email ? ` (${p.email})` : ""} — score: ${p.score}${p.interest ? ` — interest: ${p.interest}` : ""}`
).join("\n") || "None"}

## Required Output Format
{
  "actions": [
    {
      "tool": "crm_create_contact",
      "params": {
        "first_name": "Thomas",
        "last_name": "Laurent",
        "company": "StartupX",
        "email": "thomas@startupx.fr",
        "score": "hot",
        "notes": "Intéressé par le plan Pro 200€/mois"
      },
      "requiresConfirmation": true,
      "reason": "New prospect identified"
    },
    {
      "tool": "db_save_task",
      "params": {
        "title": "Clear action item title",
        "assignee": "Person name",
        "deadline": "2026-04-30",
        "priority": "medium",
        "source": "Exact quote from transcript"
      },
      "requiresConfirmation": false,
      "reason": "Saving task to local memory"
    },
    {
      "tool": "calendar_create_event",
      "params": {
        "summary": "Avril 2026 Event",
        "description": "Event created from meeting",
        "start_time": "2026-04-01T09:00:00Z",
        "end_time": "2026-04-01T10:00:00Z"
      },
      "requiresConfirmation": false,
      "reason": "Event scheduling mentioned in meeting"
    },
    {
      "tool": "email_send_recap",
      "params": {
        "target_email": "user@example.com",
        "subject": "email recap",
        "message_body": "Insert the recap summary of the transcription here. Integrate any given User Instructions."
      },
      "requiresConfirmation": false,
      "reason": "Sending meeting summary"
    }
  ],
  "summary": "Summary of decisions"
}

Return ONLY the JSON object.
`.trim();
  }

  /**
   * Parse and validate Gemini's JSON response
   * 
   * @param rawText - Raw response from Gemini
   * @returns Validated routing output
   * @throws Error if JSON invalid or validation fails
   */
  private parseAndValidate(rawText: string): z.infer<typeof RouterOutputSchema> {
    let parsed: unknown;

    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i,     "")
        .replace(/```\s*$/i,     "")
        .trim();

      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `[IntentRouter] Gemini returned invalid JSON. ` +
        `First 200 chars: ${rawText.substring(0, 200)}`
      );
    }

    const result = RouterOutputSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.issues
        .map(e => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      console.error("[IntentRouter] Validation errors:", errors);
      throw new Error(`[IntentRouter] Response validation failed: ${errors}`);
    }

    return result.data;
  }

  /**
   * Convert Gemini's routing decisions to IAction objects
   * 
   * Enforces the Confirmation Gate:
   * - ALWAYS_CRITICAL tools → requiresConfirmation = true
   * - NEVER_CRITICAL tools → requiresConfirmation = false
   * - Other tools → Use Gemini's decision
   * 
   * @param output - Validated Gemini routing decision
   * @returns Sorted IAction array
   */
  private buildActions(
    output: z.infer<typeof RouterOutputSchema>
  ): IAction[] {
    const actions: IAction[] = output.actions.map(decision => {
      let requiresConfirmation = decision.requiresConfirmation;

      // Enforce confirmation rules
      if (ALWAYS_CRITICAL_TOOLS.has(decision.tool as MCPTool)) {
        requiresConfirmation = true;  // Force approval for high-risk
      } else if (NEVER_CRITICAL_TOOLS.has(decision.tool as MCPTool)) {
        requiresConfirmation = false; // Force auto-execution for safe
      }

      return {
        id:                   `action_${nanoid(8)}`,
        tool:                 decision.tool as MCPTool,
        params:               decision.params,
        requiresConfirmation,
        status:               "pending" as ActionStatus,
      };
    });

    // Sort by tool priority
    const toolOrder: MCPTool[] = [
      "crm_create_contact",
      "crm_create_opportunity",
      "calendar_create_event",
      "crm_log_activity",
      "n8n_trigger_workflow",
      "db_save_task",
      "email_send_recap",  // Always last
    ];

    return actions.sort((a, b) => {
      const ai = toolOrder.indexOf(a.tool);
      const bi = toolOrder.indexOf(b.tool);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }
}

/**
 * Global intent router instance
 * 
 * Exported as singleton so all modules share the same Gemini client.
 * 
 * Usage:
 *   import { intentRouter } from './router';
 *   await intentRouter.decide(extraction, sessionId, skillContent);
 */
export const intentRouter = new IntentRouter();