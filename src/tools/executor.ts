// Each tool maps to one N8N webhook URL.
// N8N holds the real API credentials (RapidoCRM key, Google OAuth, etc.)
// OpenClaw never touches credentials — it just sends data to N8N.

async function callN8NWebhook(
  webhookPath: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const baseUrl = process.env.N8N_WEBHOOK_BASE_URL;
  const url = `${baseUrl}/webhook/${webhookPath}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // N8N webhook authentication header
      "X-Webhook-Auth": process.env.N8N_API_KEY || "",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`N8N webhook failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
    if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid JSON response');
    }

  return data as Record<string, unknown>;
}

// This function receives the tool name + inputs that Claude decided to use,
// and routes to the correct N8N webhook.
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  console.log(`Executing tool: ${toolName}`, toolInput);

  try {
    let result: Record<string, unknown>;

    switch (toolName) {
      case "create_crm_contact":
        result = await callN8NWebhook("rapidomeet-crm-contact", toolInput);
        return `Contact created successfully. CRM ID: ${result.contact_id || "pending"}`;

      case "create_calendar_event":
        result = await callN8NWebhook("rapidomeet-calendar-event", toolInput);
        return `Calendar event created: ${result.event_id || "pending"}. Link: ${result.event_link || ""}`;

      case "send_meeting_recap":
        result = await callN8NWebhook("rapidomeet-email-recap", toolInput);
        return `Recap sent to ${(toolInput.participants as string[])?.length || 0} participants`;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return `Tool execution failed: ${(error as Error).message}`;
  }
}