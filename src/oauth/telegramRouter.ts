import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { connectionsStore } from "../integrations/ConnectionsStore";
import { TELEGRAM_PROVIDER, getFrontendUrl } from "./telegramConfig";
import {
  buildConfirmationMessage,
  sendTelegramMessage,
  verifyTelegramBot,
} from "../integrations/TelegramClient";
import {
  getConfirmationPreferences,
  setConfirmationPreferences,
} from "../integrations/confirmationPreferences";
import type { ConfirmationChannel } from "./telegramConfig";

export const telegramRouter = Router();

function getUserId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

function normalizeChatId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBotToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** GET /auth/telegram/status */
telegramRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conn = await connectionsStore.getUserConnection(userId, TELEGRAM_PROVIDER);
  const prefs = await getConfirmationPreferences(userId);

  if (!conn) {
    return res.json({
      connected: false,
      confirmation_channel: prefs.channel,
    });
  }

  const metadata = conn.metadata ?? {};
  const isConnected = conn.status === "connected" || conn.status === "active";

  return res.json({
    connected: isConnected,
    status: conn.status,
    bot_username: metadata.bot_username ?? null,
    chat_id: metadata.chat_id ?? null,
    connected_at: metadata.connected_at ?? conn.created_at ?? null,
    confirmation_channel: prefs.channel,
  });
});

/** POST /auth/telegram/connect */
telegramRouter.post("/connect", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const botToken = normalizeBotToken(req.body?.bot_token);
  const chatId = normalizeChatId(req.body?.chat_id);

  if (!botToken) {
    return res.status(400).json({ error: "Invalid bot token format." });
  }

  if (!chatId) {
    return res.status(400).json({ error: "Chat ID is required." });
  }

  const verify = await verifyTelegramBot(botToken);
  if (!verify.ok) {
    return res.status(400).json({ error: verify.error || "Invalid bot token." });
  }

  const channel = req.body?.confirmation_channel as ConfirmationChannel | undefined;
  if (channel && channel !== "in_app" && channel !== "telegram" && channel !== "both") {
    return res.status(400).json({ error: "Invalid confirmation_channel." });
  }

  try {
    await connectionsStore.storeTelegramCredentials(
      userId,
      botToken,
      chatId,
      verify.username ?? null
    );

    if (channel) {
      await setConfirmationPreferences(userId, { channel });
    } else {
      const existing = await getConfirmationPreferences(userId);
      if (existing.channel === "in_app") {
        await setConfirmationPreferences(userId, { channel: "both" });
      }
    }

    return res.json({
      success: true,
      bot_username: verify.username ?? null,
      chat_id: chatId,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to save Telegram connection.",
    });
  }
});

/** PATCH /auth/telegram/preferences */
telegramRouter.patch("/preferences", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const channel = req.body?.confirmation_channel as ConfirmationChannel | undefined;

  if (!channel || !["in_app", "telegram", "both"].includes(channel)) {
    return res.status(400).json({ error: "confirmation_channel must be in_app, telegram, or both." });
  }

  const hasTelegram = await connectionsStore.hasActiveConnection(userId, TELEGRAM_PROVIDER);
  if ((channel === "telegram" || channel === "both") && !hasTelegram) {
    return res.status(400).json({
      error: "Connect Telegram first to use Telegram confirmations.",
    });
  }

  try {
    await setConfirmationPreferences(userId, { channel });
    return res.json({ success: true, confirmation_channel: channel });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to save preferences.",
    });
  }
});

/** POST /auth/telegram/test */
telegramRouter.post("/test", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const telegram = await connectionsStore.getTelegramConnection(userId);
    if (!telegram) {
      return res.json({
        reachable: false,
        error: "Telegram is not connected. Add your bot token and chat ID first.",
      });
    }

    const message = buildConfirmationMessage({
      actionTool: "test_connection",
      actionId: "test",
      sessionId: "demo",
      details: "This is a test message from RapidoMeet.",
      frontendUrl: getFrontendUrl(),
    });

    const result = await sendTelegramMessage(
      { botToken: telegram.botToken, chatId: telegram.chatId },
      `RapidoMeet test\n\n${message}`
    );

    if (!result.success) {
      return res.json({ reachable: false, error: result.error });
    }

    await connectionsStore.touchConnection(telegram.connectionId);
    return res.json({ reachable: true, tested_at: new Date().toISOString() });
  } catch (err) {
    return res.json({
      reachable: false,
      error: err instanceof Error ? err.message : "Test failed.",
    });
  }
});

/** DELETE /auth/telegram/disconnect */
telegramRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    await connectionsStore.revokeConnection(userId, TELEGRAM_PROVIDER);
    await setConfirmationPreferences(userId, { channel: "in_app" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to disconnect Telegram.",
    });
  }
});
