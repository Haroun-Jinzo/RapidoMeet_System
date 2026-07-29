/** Shared helper for OAuth refresh failure logs (never dump full token JSON). */
export function logTokenRefreshFailure(
  providerLabel: string,
  response: { status: number },
  data: Record<string, unknown>
): void {
  console.error(`[ConnectionsStore] ${providerLabel} token refresh failed:`, {
    status: response.status,
    error: data.error,
    error_description: data.error_description,
  });
}
