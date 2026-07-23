import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import {
  buildRhTokenRequestHeaders,
  getRhOAuthConfig,
  isRhOAuthClientConfigured,
  requireRhClientId,
  validateRhMcpUrl,
} from "./rhOAuthConfig";
import { connectionsStore, OAuthTokenPayload } from "../integrations/ConnectionsStore";
import { mcpDispatcher } from "../dispatcher";
import {
  consumeRhOAuthState,
  pruneExpiredRhOAuthStates,
  saveRhOAuthState,
} from "./rhOAuthStateStore";
import { postOAuthForm } from "./cmsOAuthHttp";

export const rhOAuthRouter = Router();

function redirectToIntegrations(res: Response, params: Record<string, string>): void {
  const { frontendUrl } = getRhOAuthConfig();
  const base = `${frontendUrl.replace(/\/$/, "")}/settings/integrations`;
  const query = new URLSearchParams(params).toString();
  res.redirect(`${base}?${query}`);
}

function getUserId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string
): Promise<OAuthTokenPayload> {
  const config = getRhOAuthConfig();
  const clientId = requireRhClientId(config.clientId);

  // Public client (token_endpoint_auth_method: none) — PKCE + client_id in body
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  }).toString();

  let data: Record<string, unknown>;
  try {
    const response = await postOAuthForm(
      config.tokenUrl,
      buildRhTokenRequestHeaders(clientId, config.clientSecret),
      body
    );
    data = response.data;
    if (!response.ok || data.error) {
      const errorCode = typeof data.error === "string" ? data.error : "unknown";
      const description =
        typeof data.error_description === "string"
          ? data.error_description
          : typeof data.message === "string"
            ? data.message
            : JSON.stringify(data);
      throw new Error(`${errorCode}: ${description}`);
    }
    if (!data.access_token) {
      throw new Error("Token response missing access_token");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "token_exchange_failed";
    if (
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ETIMEDOUT")
    ) {
      throw new Error(
        "Could not reach Rapido RH token server (network/SSL). Check your connection and try again."
      );
    }
    throw err;
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token ?? ""),
    token_type: String(data.token_type ?? "Bearer"),
    expires_at: Date.now() + expiresIn * 1000,
  };
}

/**
 * GET /auth/rh/connect
 * Starts OAuth2 authorization code + PKCE flow for Rapido RH.
 */
rhOAuthRouter.get("/connect", requireAuth, async (req: Request, res: Response) => {
  const config = getRhOAuthConfig();

  if (!isRhOAuthClientConfigured(config.clientId)) {
    return redirectToIntegrations(res, {
      error:
        "Rapido RH OAuth is not configured on the server. Set a valid RAPIDORH_CLIENT_ID in openclaw-server/.env.",
    });
  }

  const userId = getUserId(req);
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  try {
    await saveRhOAuthState(state, userId, codeVerifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start OAuth";
    console.error("[RH OAuth] Connect failed:", message);
    return redirectToIntegrations(res, { error: message });
  }

  const clientId = requireRhClientId(config.clientId);
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", config.defaultMcpUrl);

  const url = authUrl.toString();

  const wantsJson =
    req.headers.accept?.includes("application/json") || req.query.format === "json";

  if (wantsJson) {
    return res.json({ authUrl: url });
  }

  return res.redirect(url);
});

/**
 * GET /auth/rh/callback
 * Public — Rapido RH redirects the browser here (no JWT). User is bound via state.
 * Registered redirect_uri: http://localhost:3000/auth/rh/callback
 */
rhOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const config = getRhOAuthConfig();
  const oauthError = req.query.error as string | undefined;

  if (oauthError) {
    const description = req.query.error_description as string | undefined;
    const message =
      description ||
      (oauthError === "invalid_client"
        ? "Client authentication failed — check RAPIDORH_CLIENT_ID in openclaw-server/.env."
        : oauthError);
    return redirectToIntegrations(res, { error: message });
  }

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state) {
    return redirectToIntegrations(res, { error: "missing_code_or_state" });
  }

  const pending = await consumeRhOAuthState(state);

  if (!pending) {
    return redirectToIntegrations(res, {
      error:
        "OAuth session expired or was lost. Click Connect Rapido RH again (do not refresh during login).",
    });
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, pending.codeVerifier);

    await connectionsStore.storeOAuthTokens(pending.userId, "rapidorh", tokens, {
      mcp_url: config.defaultMcpUrl,
      connected_at: new Date().toISOString(),
    });

    mcpDispatcher.invalidateRhClient(pending.userId);

    console.log(`[RH OAuth] Connected Rapido RH for user ${pending.userId}`);
    return redirectToIntegrations(res, { success: "rh" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "token_exchange_failed";
    console.error("[RH OAuth] Callback failed:", message);
    return redirectToIntegrations(res, { error: message });
  }
});

/** GET /auth/rh/status */
rhOAuthRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conn = await connectionsStore.getUserConnection(userId, "rapidorh");

  if (!conn) {
    return res.json({ connected: false, status: "disconnected" });
  }

  const metadata = conn.metadata ?? {};

  const rhStatus =
    conn.status === "expired"
      ? "expired"
      : conn.status === "connected" || conn.status === "active"
        ? "connected"
        : "disconnected";

  return res.json({
    connected: rhStatus === "connected",
    status: rhStatus,
    mcp_url: connectionsStore.resolveRhMcpUrl(metadata),
    connected_at: metadata.connected_at ?? conn.created_at ?? null,
    updated_at: conn.updated_at ?? null,
  });
});

/** PUT /auth/rh/settings — optional per-user MCP server URL */
rhOAuthRouter.put("/settings", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mcp_url: mcpUrl } = req.body as { mcp_url?: string };

  if (!mcpUrl || typeof mcpUrl !== "string") {
    return res.status(400).json({ error: "mcp_url is required" });
  }

  try {
    validateRhMcpUrl(mcpUrl);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const conn = await connectionsStore.getUserConnection(userId, "rapidorh");
  if (!conn || (conn.status !== "connected" && conn.status !== "active")) {
    return res.status(400).json({ error: "Connect Rapido RH before updating MCP settings." });
  }

  const updated = await connectionsStore.updateRhMcpUrl(userId, mcpUrl);
  mcpDispatcher.invalidateRhClient(userId);

  return res.json({
    success: true,
    mcp_url: connectionsStore.resolveRhMcpUrl(updated.metadata),
  });
});

/** POST /auth/rh/test */
rhOAuthRouter.post("/test", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { accessToken, mcpUrl, connectionId } = await connectionsStore.getRHConnection(userId);

    const response = await fetch(mcpUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json, text/event-stream",
      },
    });

    await connectionsStore.touchConnection(connectionId);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.json({
        reachable: false,
        error: `MCP server returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      });
    }

    return res.json({
      reachable: true,
      tested_at: new Date().toISOString(),
      mcp_url: mcpUrl,
    });
  } catch (err) {
    return res.json({
      reachable: false,
      error: (err as Error).message,
    });
  }
});

/** DELETE /auth/rh/disconnect */
rhOAuthRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  await connectionsStore.revokeConnection(userId, "rapidorh");
  mcpDispatcher.invalidateRhClient(userId);

  return res.json({ success: true });
});

setInterval(() => {
  void pruneExpiredRhOAuthStates();
}, 5 * 60 * 1000);
