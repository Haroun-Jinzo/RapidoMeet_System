import { Router } from "express";
import { requireInternalAuth } from "./internalAuth";
import { connectionsStore } from "../integrations/ConnectionsStore";
import { sessionManager } from "../session";

export const internalRouter = Router();

// Apply internal secret middleware to all routes inside this router
internalRouter.use(requireInternalAuth);

/**
 * Validates the connection/session/action ownership and status.
 */
async function validateRequestSafely(connectionId: string, sessionId: string, actionId?: string): Promise<{ connection: any, session: any }> {
  if (!connectionId || !sessionId) {
    throw new Error("Missing connection_id or session_id");
  }

  const session = await sessionManager.load(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const connection = await connectionsStore.getConnection(connectionId);
  if (!connection) {
    throw new Error("Connection not found");
  }

  // 1. Connection must belong to the session's user
  if (connection.user_id !== session.userId) {
    throw new Error("Connection does not belong to the session's user");
  }

  if (connection.status !== 'active') {
    throw new Error("Connection is not active");
  }

  // 2. Action validation (if provided).
  // Some requests (like global tools) might only need connection, but if action is bound, it must be valid.
  if (actionId) {
    const action = session.actions?.find((a: any) => a.id === actionId);
    if (!action) {
      throw new Error("Action not found in session");
    }

    if (action.requiresConfirmation && action.status !== 'confirmed') {
      throw new Error(`Action is not confirmed (current status: ${action.status})`);
    }
  }

  return { connection, session };
}

/**
 * Endpoint for OpenClaw to mint a short-lived Google Access Token
 * from the stored refresh_token in Supabase Vault.
 */
internalRouter.post("/google/access-token", async (req, res) => {
  try {
    const { connection_id, session_id, action_id } = req.body;
    
    // Safety check mapping tenant/session logic
    const { connection } = await validateRequestSafely(connection_id, session_id, action_id);

    if (connection.provider !== "google") {
      return res.status(400).json({ error: "Connection is not a Google connection" });
    }

    const refreshToken = await connectionsStore.getVaultSecret(connection.vault_secret_id);
    if (!refreshToken) {
      return res.status(404).json({ error: "Google connection secret not found in vault" });
    }

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
      return res.status(400).json({ error: "Failed to mint Google access token" }); // Avoid leaking 'data' which might contain secret error texts
    }

    // Never return the refresh token, only the temporary access token
    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (error: any) {
    console.error("Failed Google token request:", error.message);
    res.status(403).json({ error: error.message || "Unauthorized token request" });
  }
});

/**
 * Proxy for Telegram to send a message without exposing the bot token to OpenClaw.
 * Lookup telegram bot token from connections store using connection_id
 */
internalRouter.post("/telegram/sendMessage", async (req, res) => {
  try {
    const { connection_id, session_id, action_id, chat_id, text } = req.body;
    
    if (!chat_id || !text) {
      return res.status(400).json({ error: "Missing chat_id or text" });
    }

    const { connection } = await validateRequestSafely(connection_id, session_id, action_id);
    
    if (connection.provider !== "telegram") {
       return res.status(400).json({ error: "Connection is not a Telegram connection" });
    }

    const botToken = await connectionsStore.getVaultSecret(connection.vault_secret_id);
    if (!botToken) {
      return res.status(404).json({ error: "Telegram bot token missing in Vault" });
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text }),
    });

    const body: any = await tgRes.json();
    if (!tgRes.ok) {
       console.error("Telegram remote error");
       return res.status(500).json({ error: "Telegram proxy failed" }); // Do not leak body.description details here to unknown parties
    }

    res.json({ success: true, message_id: body.result.message_id });
  } catch (error: any) {
    console.error("Telegram proxy error:", error.message);
    res.status(403).json({ error: error.message || "Telegram proxy failed to authorize" });
  }
});

/**
 * Callback endpoint for OpenClaw to post execution results back to RapidoMeet.
 */
internalRouter.post("/openclaw/session-update", async (req, res) => {
  try {
    const { session_id, results, status } = req.body;
    
    if (!session_id || !results) {
      return res.status(400).json({ error: "Missing session_id or results" });
    }

    const session = await sessionManager.load(session_id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Attach results to session actions
    // Expecting results to map: result.action_id or similar.
    let updated = false;
    for (const result of results) {
       const action = session.actions?.find((a: any) => a.id === result.action_id);
       if (action) {
         action.execution_status = result.status;
         action.execution_result = result.output;
         action.updated_at = new Date().toISOString();
         updated = true;
       }
    }

    if (status === 'completed' || status === 'failed') {
      session.status = status;
      updated = true;
    }

    if (updated) {
      await sessionManager.save(session);
      // In a real app we might also write to MemoryManager/PostgreSQL
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Callback update failed:", error.message);
    res.status(500).json({ error: "Callback processing failed" });
  }
});

