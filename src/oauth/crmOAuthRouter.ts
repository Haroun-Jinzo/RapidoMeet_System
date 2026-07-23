import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import {
  buildTokenRequestHeaders,
  getCrmOAuthConfig,
  isCrmOAuthClientConfigured,
  requireCrmClientId,
  validateMcpUrl,
} from "./crmOAuthConfig";
import { connectionsStore, OAuthTokenPayload } from "../integrations/ConnectionsStore";
import { mcpDispatcher } from "../dispatcher";
import { consumeCrmOAuthState, pruneExpiredCrmOAuthStates, saveCrmOAuthState } from "./crmOAuthStateStore";
import { postOAuthForm } from "./crmOAuthHttp";

export const crmOAuthRouter = Router();

function redirectToIntegrations(res: Response, params: Record<string, string>): void {
  const { frontendUrl } = getCrmOAuthConfig();
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
  const config = getCrmOAuthConfig();
  const clientId = requireCrmClientId(config.clientId);

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
      buildTokenRequestHeaders(clientId, config.clientSecret),
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
    if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("ETIMEDOUT")) {
      throw new Error(
        "Could not reach RapidoCRM token server (network/SSL). Check your connection and try again."
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
 * GET /auth/crm/connect
 * Starts OAuth2 authorization code + PKCE flow (public client — no client_secret required).
 */
crmOAuthRouter.get("/connect", requireAuth, async (req: Request, res: Response) => {
  const config = getCrmOAuthConfig();

  if (!isCrmOAuthClientConfigured(config.clientId)) {
    return redirectToIntegrations(res, {
      error:
        "RapidoCRM OAuth is not configured on the server. Set a valid RAPIDOCRM_CLIENT_ID in openclaw-server/.env (register an OAuth app in RapidoCRM admin).",
    });
  }

  const userId = getUserId(req);
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  try {
    await saveCrmOAuthState(state, userId, codeVerifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start OAuth";
    console.error("[CRM OAuth] Connect failed:", message);
    return redirectToIntegrations(res, { error: message });
  }

  const clientId = requireCrmClientId(config.clientId);
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
    req.headers.accept?.includes("application/json") ||
    req.query.format === "json";

  if (wantsJson) {
    return res.json({ authUrl: url });
  }

  return res.redirect(url);
});

/**
 * GET /auth/crm/callback
 * Public — RapidoCRM redirects the browser here (no JWT). User is bound via state.
 */
crmOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const config = getCrmOAuthConfig();
  const oauthError = req.query.error as string | undefined;

  if (oauthError) {
    const description = req.query.error_description as string | undefined;
    const message =
      description ||
      (oauthError === "invalid_client"
        ? "Client authentication failed — check RAPIDOCRM_CLIENT_ID and RAPIDOCRM_CLIENT_SECRET in openclaw-server/.env."
        : oauthError);
    return redirectToIntegrations(res, { error: message });
  }

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state) {
    return redirectToIntegrations(res, { error: "missing_code_or_state" });
  }

  const pending = await consumeCrmOAuthState(state);

  if (!pending) {
    return redirectToIntegrations(res, {
      error:
        "OAuth session expired or was lost. Click Connect RapidoCRM again (do not refresh during login).",
    });
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, pending.codeVerifier);

    await connectionsStore.storeOAuthTokens(pending.userId, "rapidocrm", tokens, {
      mcp_url: config.defaultMcpUrl,
      connected_at: new Date().toISOString(),
    });

    mcpDispatcher.invalidateCrmClient(pending.userId);

    console.log(`[CRM OAuth] Connected RapidoCRM for user ${pending.userId}`);
    return redirectToIntegrations(res, { success: "crm" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "token_exchange_failed";
    console.error("[CRM OAuth] Callback failed:", message);
    return redirectToIntegrations(res, { error: message });
  }
});

/** GET /auth/crm/status */
crmOAuthRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conn = await connectionsStore.getUserConnection(userId, "rapidocrm");

  if (!conn) {
    return res.json({ connected: false });
  }

  const metadata = conn.metadata ?? {};

  const crmStatus =
    conn.status === "expired"
      ? "expired"
      : conn.status === "connected" || conn.status === "active"
        ? "connected"
        : "disconnected";

  return res.json({
    connected: crmStatus === "connected",
    status: crmStatus,
    mcp_url: connectionsStore.resolveMcpUrl(metadata),
    connected_at: metadata.connected_at ?? conn.created_at ?? null,
    updated_at: conn.updated_at ?? null,
  });
});

/** PUT /auth/crm/settings — optional per-user MCP server URL */
crmOAuthRouter.put("/settings", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { mcp_url: mcpUrl } = req.body as { mcp_url?: string };

  if (!mcpUrl || typeof mcpUrl !== "string") {
    return res.status(400).json({ error: "mcp_url is required" });
  }

  try {
    validateMcpUrl(mcpUrl);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const conn = await connectionsStore.getUserConnection(userId, "rapidocrm");
  if (!conn || (conn.status !== "connected" && conn.status !== "active")) {
    return res.status(400).json({ error: "Connect RapidoCRM before updating MCP settings." });
  }

  const updated = await connectionsStore.updateMcpUrl(userId, mcpUrl);
  mcpDispatcher.invalidateCrmClient(userId);

  return res.json({
    success: true,
    mcp_url: connectionsStore.resolveMcpUrl(updated.metadata),
  });
});

/** POST /auth/crm/test */
crmOAuthRouter.post("/test", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { accessToken, mcpUrl, connectionId } = await connectionsStore.getCRMConnection(userId);

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

/** DELETE /auth/crm/disconnect */
crmOAuthRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  await connectionsStore.revokeConnection(userId, "rapidocrm");
  mcpDispatcher.invalidateCrmClient(userId);

  return res.json({ success: true });
});

setInterval(() => {
  void pruneExpiredCrmOAuthStates();
}, 5 * 60 * 1000);
