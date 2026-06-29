export interface TelegramSendResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

function stripMarkdownForPlainText(message: string): string {
  return message
    .replace(/[*_`[\]()~>#+=|{}.!\\\-]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendTelegramMessage(
  credentials: TelegramCredentials,
  message: string,
  options?: { parseMode?: "MarkdownV2" | "HTML" | "plain" }
): Promise<TelegramSendResult> {
  const parseMode = options?.parseMode ?? "plain";
  const url = `https://api.telegram.org/bot${credentials.botToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: credentials.chatId,
    text: parseMode === "plain" ? stripMarkdownForPlainText(message) : message,
    disable_web_page_preview: true,
  };

  if (parseMode !== "plain") {
    body.parse_mode = parseMode;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!data.ok) {
      if (parseMode === "MarkdownV2") {
        return sendTelegramMessage(credentials, message, { parseMode: "plain" });
      }
      return {
        success: false,
        error: data.description || `Telegram API error (${response.status})`,
      };
    }

    return { success: true, messageId: data.result?.message_id };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function verifyTelegramBot(botToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await response.json()) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };

    if (!data.ok) {
      return { ok: false, error: data.description || "Invalid bot token" };
    }

    return { ok: true, username: data.result?.username };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function buildConfirmationMessage(input: {
  actionTool: string;
  actionId: string;
  sessionId: string;
  details: string;
  frontendUrl: string;
}): string {
  const toolLabel = input.actionTool.replace(/_/g, " ");
  const meetingUrl = `${input.frontendUrl}/app/reunions?session=${encodeURIComponent(input.sessionId)}`;

  return [
    "Requires approval",
    "",
    `Action: ${toolLabel}`,
    `ID: ${input.actionId}`,
    "",
    "Details:",
    input.details,
    "",
    `Approve or refuse in RapidoMeet: ${meetingUrl}`,
    "",
    "You can also approve directly in the pipeline panel while the meeting is processing.",
  ].join("\n");
}
