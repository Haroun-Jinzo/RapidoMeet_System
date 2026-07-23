import { createClient } from "@supabase/supabase-js";

const RH_OAUTH_PROVIDER = "rapidorh";
const STATE_TTL_MS = 10 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export interface PendingRhOAuth {
  userId: string;
  codeVerifier: string;
}

export async function saveRhOAuthState(
  state: string,
  userId: string,
  codeVerifier: string
): Promise<void> {
  const { error } = await supabase.from("oauth_states").upsert(
    {
      state,
      user_id: userId,
      provider: RH_OAUTH_PROVIDER,
      code_verifier: codeVerifier,
      created_at: new Date().toISOString(),
    },
    { onConflict: "state" }
  );

  if (error) {
    throw new Error(`[RH OAuth] Failed to save OAuth state: ${error.message}`);
  }
}

export async function consumeRhOAuthState(state: string): Promise<PendingRhOAuth | null> {
  const { data, error } = await supabase
    .from("oauth_states")
    .select("user_id, code_verifier, created_at")
    .eq("state", state)
    .eq("provider", RH_OAUTH_PROVIDER)
    .maybeSingle();

  if (error) {
    console.error("[RH OAuth] State lookup failed:", error.message);
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

/** Remove oauth_states older than TTL (best-effort housekeeping). */
export async function pruneExpiredRhOAuthStates(): Promise<void> {
  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  await supabase
    .from("oauth_states")
    .delete()
    .eq("provider", RH_OAUTH_PROVIDER)
    .lt("created_at", cutoff);
}
