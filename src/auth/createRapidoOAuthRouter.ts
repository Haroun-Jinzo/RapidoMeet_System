import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { connectionsStore, OAuthTokenPayload } from "../integrations/ConnectionsStore";
import { postOAuthForm } from "./oauthHttp";
import { createOAuthStateStore } from "./oauthStateStore";

export interface RapidoOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scope: string;
  defaultMcpUrl: string;
  frontendUrl: string;
}

export interface RapidoOAuthRouterOptions {
  provider: "rapidocrm" | "rapidocms" | "rapidorh";
  logLabel: string;
  productName: string;
  successParam: string;
  getConfig: () => RapidoOAuthConfig;
  isClientConfigured: (clientId?: string | null) => boolean;
  requireClientId: (clientId?: string | null) => string;
  buildTokenRequestHeaders: (clientId: string, clientSecret?: string) => Record<string, string>;
  validateMcpUrl: (url: string) => string;
  invalidateClient: (userId: string) => void;
  getConnection: (userId: string) => Promise<{
    accessToken: string;
    mcpUrl: string;
    connectionId: string;
  }>;
  updateMcpUrl: (userId: string, mcpUrl: string) => Promise<{ metadata?: Record<string, unknown> | null }>;
  resolveMcpUrl: (metadata: Record<string, unknown> | null | undefined) => string;
  notConfiguredMessage: string;
  networkErrorMessage: string;
  reconnectHint: string;
}

export function createRapidoOAuthRouter(options: RapidoOAuthRouterOptions): Router {
  const router = Router();
  const stateStore = createOAuthStateStore(options.provider, options.logLabel);

  function redirectToIntegrations(res: Response, params: Record<string, string>): void {
    const { frontendUrl } = options.getConfig();
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
    const config = options.getConfig();
    const clientId = options.requireClientId(config.clientId);

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
        options.buildTokenRequestHeaders(clientId, config.clientSecret),
        body,
        `${options.productName} token request`
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
        throw new Error(options.networkErrorMessage);
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

  router.get("/connect", requireAuth, async (req: Request, res: Response) => {
    const config = options.getConfig();

    if (!options.isClientConfigured(config.clientId)) {
      return redirectToIntegrations(res, { error: options.notConfiguredMessage });
    }

    const userId = getUserId(req);
    const state = crypto.randomUUID();
    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    try {
      await stateStore.saveOAuthState(state, userId, codeVerifier);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start OAuth";
      console.error(`[${options.logLabel}] Connect failed:`, message);
      return redirectToIntegrations(res, { error: message });
    }

    const clientId = options.requireClientId(config.clientId);
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

  router.get("/callback", async (req: Request, res: Response) => {
    const config = options.getConfig();
    const oauthError = req.query.error as string | undefined;

    if (oauthError) {
      const description = req.query.error_description as string | undefined;
      const message =
        description ||
        (oauthError === "invalid_client"
          ? `Client authentication failed — check ${options.productName} client id/secret in openclaw-server/.env.`
          : oauthError);
      return redirectToIntegrations(res, { error: message });
    }

    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code || !state) {
      return redirectToIntegrations(res, { error: "missing_code_or_state" });
    }

    const pending = await stateStore.consumeOAuthState(state);
    if (!pending) {
      return redirectToIntegrations(res, { error: options.reconnectHint });
    }

    try {
      const tokens = await exchangeAuthorizationCode(code, pending.codeVerifier);

      await connectionsStore.storeOAuthTokens(pending.userId, options.provider, tokens, {
        mcp_url: config.defaultMcpUrl,
        connected_at: new Date().toISOString(),
      });

      options.invalidateClient(pending.userId);

      console.log(`[${options.logLabel}] Connected ${options.productName} for user ${pending.userId}`);
      return redirectToIntegrations(res, { success: options.successParam });
    } catch (err) {
      const message = err instanceof Error ? err.message : "token_exchange_failed";
      console.error(`[${options.logLabel}] Callback failed:`, message);
      return redirectToIntegrations(res, { error: message });
    }
  });

  router.get("/status", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const conn = await connectionsStore.getUserConnection(userId, options.provider);

    if (!conn) {
      return res.json({ connected: false });
    }

    const metadata = conn.metadata ?? {};
    const status =
      conn.status === "expired"
        ? "expired"
        : conn.status === "connected" || conn.status === "active"
          ? "connected"
          : "disconnected";

    return res.json({
      connected: status === "connected",
      status,
      mcp_url: options.resolveMcpUrl(metadata),
      connected_at: metadata.connected_at ?? conn.created_at ?? null,
      updated_at: conn.updated_at ?? null,
    });
  });

  router.put("/settings", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { mcp_url: mcpUrl } = req.body as { mcp_url?: string };

    if (!mcpUrl || typeof mcpUrl !== "string") {
      return res.status(400).json({ error: "mcp_url is required" });
    }

    try {
      options.validateMcpUrl(mcpUrl);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    const conn = await connectionsStore.getUserConnection(userId, options.provider);
    if (!conn || (conn.status !== "connected" && conn.status !== "active")) {
      return res
        .status(400)
        .json({ error: `Connect ${options.productName} before updating MCP settings.` });
    }

    const updated = await options.updateMcpUrl(userId, mcpUrl);
    options.invalidateClient(userId);

    return res.json({
      success: true,
      mcp_url: options.resolveMcpUrl(updated.metadata),
    });
  });

  router.post("/test", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req);

    try {
      const { accessToken, mcpUrl, connectionId } = await options.getConnection(userId);

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

  router.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    await connectionsStore.revokeConnection(userId, options.provider);
    options.invalidateClient(userId);
    return res.json({ success: true });
  });

  setInterval(() => {
    void stateStore.pruneExpiredOAuthStates();
  }, 5 * 60 * 1000);

  return router;
}
