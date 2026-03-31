import { Router } from "express";
import { requireInternalAuth } from "./internalAuth";
import { connectionsStore } from "../integrations/ConnectionsStore";

export const internalRouter = Router();

// Apply internal secret middleware to all routes inside this router
internalRouter.use(requireInternalAuth);

/**
 * Endpoint for OpenClaw to mint a short-lived Google Access Token
 * from the stored refresh_token in Supabase.
 */
internalRouter.post("/google/access-token", async (req, res) => {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }

  const refreshToken = await connectionsStore.getConnectionSecret(user_id, "google");
  
  if (!refreshToken) {
    return res.status(404).json({ error: "Google connection not found or unauthorized" });
  }

  try {
    // Exchange refresh token for an access token via Google OAuth2 endpoint
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      console.error("Google token exchange error:", data);
      return res.status(400).json({ error: "Failed to mint Google access token", details: data });
    }

    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (error: any) {
    console.error("Failed Google token request:", error);
    res.status(500).json({ error: "Upstream token request failed" });
  }
});

/**
 * Proxy for Telegram to send a message without exposing the bot token to OpenClaw.
 * Optionally looking up a user-connected Telegram bot in the future.
 */
internalRouter.post("/telegram/sendMessage", async (req, res) => {
  const { chat_id, text } = req.body;
  
  if (!chat_id || !text) {
    return res.status(400).json({ error: "Missing chat_id or text" });
  }

  // Right now using a global bot token from ENV.
  // Could be updated to fetch from connectionsStore if user brings their own bot.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ error: "Telegram bot token missing globally" });

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text }),
    });

    const body: any = await tgRes.json();
    if (!tgRes.ok) throw new Error(body.description);

    res.json({ success: true, message_id: body.result.message_id });
  } catch (error: any) {
    console.error("Telegram proxy error:", error.message);
    res.status(500).json({ error: "Telegram proxy failed", details: error.message });
  }
});

