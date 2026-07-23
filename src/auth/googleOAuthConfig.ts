/** Shared Google Calendar OAuth configuration from environment. */

export const GOOGLE_CALENDAR_PROVIDER = "google_calendar";

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const authUrl =
    process.env.GOOGLE_AUTH_URL?.trim() ||
    "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenUrl =
    process.env.GOOGLE_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token";
  const revokeUrl =
    process.env.GOOGLE_REVOKE_URL?.trim() || "https://oauth2.googleapis.com/revoke";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    "http://localhost:3000/auth/google/callback";
  const scopes =
    process.env.GOOGLE_SCOPES?.trim() ||
    "https://www.googleapis.com/auth/calendar openid email profile";
  const frontendUrl = process.env.FRONTEND_URL?.trim() || "http://localhost:5173";

  return {
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
    revokeUrl,
    redirectUri,
    scopes,
    frontendUrl,
  };
}

export function isGoogleOAuthConfigured(): boolean {
  const config = getGoogleOAuthConfig();
  return Boolean(config.clientId && config.clientSecret);
}
