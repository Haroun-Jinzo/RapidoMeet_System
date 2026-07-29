import { createClient } from "@supabase/supabase-js";

const STATE_TTL_MS = 10 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export interface PendingOAuth {
  userId: string;
  codeVerifier: string;
}

export function createOAuthStateStore(provider: string, logLabel: string) {
  async function saveOAuthState(
    state: string,
    userId: string,
    codeVerifier: string
  ): Promise<void> {
    const { error } = await supabase.from("oauth_states").upsert(
      {
        state,
        user_id: userId,
        provider,
        code_verifier: codeVerifier,
        created_at: new Date().toISOString(),
      },
      { onConflict: "state" }
    );

    if (error) {
      throw new Error(`[${logLabel}] Failed to save OAuth state: ${error.message}`);
    }
  }

  async function consumeOAuthState(state: string): Promise<PendingOAuth | null> {
    const { data, error } = await supabase
      .from("oauth_states")
      .select("user_id, code_verifier, created_at")
      .eq("state", state)
      .eq("provider", provider)
      .maybeSingle();

    if (error) {
      console.error(`[${logLabel}] State lookup failed:`, error.message);
      return null;
    }

    if (!data?.user_id || !data.code_verifier) {
      return null;
    }

    const createdAt = new Date(data.created_at as string).getTime();
    if (Number.isNaN(createdAt) || Date.now() - createdAt > STATE_TTL_MS) {
      await supabase.from("oauth_states").delete().eq("state", state);
      return null;
    }

    await supabase.from("oauth_states").delete().eq("state", state);

    return {
      userId: data.user_id as string,
      codeVerifier: data.code_verifier as string,
    };
  }

  async function pruneExpiredOAuthStates(): Promise<void> {
    const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
    await supabase.from("oauth_states").delete().eq("provider", provider).lt("created_at", cutoff);
  }

  return { saveOAuthState, consumeOAuthState, pruneExpiredOAuthStates };
}
