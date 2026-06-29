import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import {
  getGoogleOAuthConfig,
  GOOGLE_CALENDAR_PROVIDER,
  isGoogleOAuthConfigured,
} from "./googleOAuthConfig";
import { connectionsStore, OAuthTokenPayload } from "../integrations/ConnectionsStore";
import {
  fetchGoogleTokenScopes,
  GOOGLE_SCOPE_RECONNECT_MESSAGE,
  tokenHasCalendarWriteScope,
} from "./googleScopeUtils";
import {
  consumeGoogleOAuthState,
  pruneExpiredGoogleOAuthStates,
  saveGoogleOAuthState,
} from "./googleOAuthStateStore";

export const googleOAuthRouter = Router();

function redirectToIntegrations(res: Response, params: Record<string, string>): void {
  const { frontendUrl } = getGoogleOAuthConfig();
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
): Promise<OAuthTokenPayload & { scope?: string }> {
  const config = getGoogleOAuthConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("Google OAuth is not configured on the server.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok || data.error) {
    const errorCode = typeof data.error === "string" ? data.error : "unknown";
    const description =
      typeof data.error_description === "string"
        ? data.error_description
        : JSON.stringify(data);
    throw new Error(`${errorCode}: ${description}`);
  }

  if (!data.access_token) {
    throw new Error("Token response missing access_token");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const scope =
    typeof data.scope === "string" && data.scope.trim()
      ? data.scope.trim()
      : undefined;

  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token ?? ""),
    token_type: String(data.token_type ?? "Bearer"),
    expires_at: Date.now() + expiresIn * 1000,
    scope,
  };
}

async function fetchGoogleProfile(accessToken: string): Promise<{ email?: string; name?: string }> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn("[Google OAuth] userinfo fetch failed:", response.status);
    return {};
  }

  const profile = (await response.json()) as { email?: string; name?: string };
  return { email: profile.email, name: profile.name };
}

/**
 * GET /auth/google/connect
 * Starts OAuth2 authorization code + PKCE flow for Google Calendar.
 */
googleOAuthRouter.get("/connect", requireAuth, async (req: Request, res: Response) => {
  if (!isGoogleOAuthConfigured()) {
    return redirectToIntegrations(res, {
      error:
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
    });
  }

  const config = getGoogleOAuthConfig();
  const userId = getUserId(req);
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  saveGoogleOAuthState(state, userId, codeVerifier);

  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId!);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", config.scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

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
 * GET /auth/google/callback
 * Public — Google redirects the browser here (no JWT).
 */
googleOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const oauthError = req.query.error as string | undefined;

  if (oauthError) {
    return redirectToIntegrations(res, { error: "google_denied" });
  }

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state) {
    return redirectToIntegrations(res, { error: "missing_code_or_state" });
  }

  const pending = consumeGoogleOAuthState(state);

  if (!pending) {
    return redirectToIntegrations(res, { error: "invalid_state" });
  }

  try {
    const config = getGoogleOAuthConfig();
    const tokens = await exchangeAuthorizationCode(code, pending.codeVerifier);
    const profile = await fetchGoogleProfile(tokens.access_token);

    const grantedScopes =
      tokens.scope ??
      (await fetchGoogleTokenScopes(tokens.access_token)) ??
      config.scopes;

    if (!tokenHasCalendarWriteScope(grantedScopes)) {
      console.error(
        `[Google OAuth] Connected user ${pending.userId} but token lacks Calendar write scope:`,
        grantedScopes
      );
      return redirectToIntegrations(res, {
        error: "google_missing_calendar_scope",
      });
    }

    await connectionsStore.storeOAuthTokens(
      pending.userId,
      GOOGLE_CALENDAR_PROVIDER,
      tokens,
      {
        google_email: profile.email ?? null,
        google_name: profile.name ?? null,
        connected_at: new Date().toISOString(),
        granted_scopes: grantedScopes,
        requested_scopes: config.scopes,
      }
    );

    console.log(`[Google OAuth] Connected Google Calendar for user ${pending.userId}`);
    return redirectToIntegrations(res, { success: "google_calendar" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "token_exchange_failed";
    console.error("[Google OAuth] Callback failed:", message);
    return redirectToIntegrations(res, { error: message });
  }
});

/** GET /auth/google/status */
googleOAuthRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conn = await connectionsStore.getUserConnection(userId, GOOGLE_CALENDAR_PROVIDER);

  if (!conn) {
    return res.json({ connected: false });
  }

  const metadata = conn.metadata ?? {};
  const isConnected =
    conn.status === "connected" || conn.status === "active";

  return res.json({
    connected: isConnected,
    google_email: metadata.google_email ?? null,
    google_name: metadata.google_name ?? null,
    connected_at: metadata.connected_at ?? conn.created_at ?? null,
    status: conn.status,
    has_calendar_write: tokenHasCalendarWriteScope(
      (metadata.granted_scopes as string) ?? null
    ),
  });
});

/** POST /auth/google/test */
googleOAuthRouter.post("/test", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { accessToken, connectionId } =
      await connectionsStore.getGoogleCalendarConnection(userId);

    const tokenScopes =
      (await fetchGoogleTokenScopes(accessToken)) ?? undefined;

    if (!tokenHasCalendarWriteScope(tokenScopes)) {
      return res.json({
        reachable: false,
        error: GOOGLE_SCOPE_RECONNECT_MESSAGE,
        granted_scopes: tokenScopes ?? null,
      });
    }

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (response.status === 401) {
      await connectionsStore.markConnectionExpired(connectionId);
      return res.json({
        reachable: false,
        error: "Token expired — please reconnect",
      });
    }

    if (response.status === 403) {
      return res.json({
        reachable: false,
        error: GOOGLE_SCOPE_RECONNECT_MESSAGE,
        granted_scopes: tokenScopes ?? null,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return res.json({
        reachable: false,
        error: `Google Calendar API returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      });
    }

    await connectionsStore.touchConnection(connectionId);

    return res.json({
      reachable: true,
      tested_at: new Date().toISOString(),
      granted_scopes: tokenScopes ?? null,
    });
  } catch (err) {
    return res.json({
      reachable: false,
      error: (err as Error).message,
    });
  }
});

/** DELETE /auth/google/disconnect */
googleOAuthRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = getUserId(req);

  try {
    const { accessToken } = await connectionsStore.getGoogleCalendarConnection(userId);
    const config = getGoogleOAuthConfig();

    await fetch(`${config.revokeUrl}?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch((err) => {
      console.warn("[Google OAuth] Token revoke failed (best-effort):", (err as Error).message);
    });
  } catch {
    // No active connection — still mark revoked below
  }

  await connectionsStore.revokeConnection(userId, GOOGLE_CALENDAR_PROVIDER, {
    status: "revoked",
  });

  return res.json({ success: true });
});

setInterval(() => {
  pruneExpiredGoogleOAuthStates();
}, 5 * 60 * 1000);
