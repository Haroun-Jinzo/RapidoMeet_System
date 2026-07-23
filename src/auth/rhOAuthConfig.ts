/** Shared Rapido RH OAuth / MCP configuration from environment. */

export const RAPIDORH_PROVIDER = "rapidorh";

const PLACEHOLDER_CLIENT_IDS = new Set([
  "42",
  "your_client_id_from_dynamic_registration",
  "your_client_id",
]);

export function isRhOAuthClientConfigured(clientId?: string | null): boolean {
  const id = clientId?.trim();
  if (!id) return false;
  return !PLACEHOLDER_CLIENT_IDS.has(id);
}

export function requireRhClientId(clientId?: string | null): string {
  const id = clientId?.trim();
  if (!isRhOAuthClientConfigured(id)) {
    throw new Error("RAPIDORH_CLIENT_ID is not configured on the server.");
  }
  return id!;
}

export function getRhOAuthConfig() {
  const clientId = process.env.RAPIDORH_CLIENT_ID?.trim();
  const clientSecret = process.env.RAPIDORH_CLIENT_SECRET?.trim() || undefined;
  const authUrl =
    process.env.RAPIDORH_AUTH_URL?.trim() || "https://rh.rapidosoftware.com/oauth/authorize";
  const tokenUrl =
    process.env.RAPIDORH_TOKEN_URL?.trim() || "https://rh.rapidosoftware.com/oauth/token";
  const defaultMcpUrl =
    process.env.RAPIDORH_MCP_URL?.trim() || "https://rh.rapidosoftware.com/mcp";
  const redirectUri =
    process.env.RAPIDORH_REDIRECT_URI?.trim() || "http://localhost:3000/auth/rh/callback";
  const scope = process.env.RAPIDORH_SCOPE?.trim() || "mcp:use";
  const frontendUrl = process.env.FRONTEND_URL?.trim() || "http://localhost:8080";

  return {
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
    defaultMcpUrl,
    redirectUri,
    scope,
    frontendUrl,
  };
}

/** Optional Basic Auth when a confidential client secret is configured. */
export function buildRhTokenRequestHeaders(
  clientId: string,
  clientSecret?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  return headers;
}

/** Validate user-supplied MCP URL (HTTPS, no private IPs). */
export function validateRhMcpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Invalid MCP URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("MCP URL must use HTTPS");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host === "0.0.0.0"
  ) {
    throw new Error("MCP URL cannot point to a private network address");
  }

  return parsed.toString().replace(/\/$/, "");
}
