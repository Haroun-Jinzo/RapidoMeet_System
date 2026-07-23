const STATE_TTL_MS = 10 * 60 * 1000;

interface PendingGoogleOAuth {
  userId: string;
  codeVerifier: string;
  expiresAt: number;
}

const stateStore = new Map<string, PendingGoogleOAuth>();

export function saveGoogleOAuthState(
  state: string,
  userId: string,
  codeVerifier: string
): void {
  stateStore.set(state, {
    userId,
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
}

export function consumeGoogleOAuthState(state: string): PendingGoogleOAuth | null {
  const entry = stateStore.get(state);
  stateStore.delete(state);

  if (!entry || Date.now() > entry.expiresAt) {
    return null;
  }

  return entry;
}

export function pruneExpiredGoogleOAuthStates(): void {
  const now = Date.now();
  for (const [key, entry] of stateStore) {
    if (now > entry.expiresAt) {
      stateStore.delete(key);
    }
  }
}
