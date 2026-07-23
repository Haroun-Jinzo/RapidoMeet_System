/** Scopes that allow creating calendar events via the Calendar API. */
export const GOOGLE_CALENDAR_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GOOGLE_SCOPE_RECONNECT_MESSAGE =
  "Google Calendar access is missing the Calendar permission. " +
  "Disconnect Google Calendar in Settings → Integrations, then connect again. " +
  "Also ensure the Google Cloud OAuth consent screen includes the Calendar scope.";

export function tokenHasCalendarWriteScope(scopeString: string | undefined | null): boolean {
  if (!scopeString?.trim()) return false;
  const granted = scopeString.split(/\s+/).filter(Boolean);
  return GOOGLE_CALENDAR_WRITE_SCOPES.some((required) => granted.includes(required));
}

export async function fetchGoogleTokenScopes(
  accessToken: string
): Promise<string | null> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { scope?: string; error?: string };
  if (data.error || !data.scope) {
    return null;
  }

  return data.scope;
}

export function formatInsufficientScopeError(apiBody: string): string {
  if (
    apiBody.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    apiBody.includes("insufficientPermissions") ||
    apiBody.includes("Insufficient Permission")
  ) {
    return GOOGLE_SCOPE_RECONNECT_MESSAGE;
  }
  return `Google Calendar API error: ${apiBody}`;
}
