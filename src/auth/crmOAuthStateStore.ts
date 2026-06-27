import { createClient } from "@supabase/supabase-js";

const CRM_OAUTH_PROVIDER = "rapidocrm";
const STATE_TTL_MS = 10 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export interface PendingCrmOAuth {
  userId: string;
  codeVerifier: string;
}

export async function saveCrmOAuthState(
  state: string,
  userId: string,
  codeVerifier: string
): Promise<void> {
  const { error } = await supabase.from("oauth_states").upsert(
    {
      state,
      user_id: userId,
      provider: CRM_OAUTH_PROVIDER,
      code_verifier: codeVerifier,
      created_at: new Date().toISOString(),
    },
    { onConflict: "state" }
  );

  if (error) {
    throw new Error(`[CRM OAuth] Failed to save OAuth state: ${error.message}`);
  }
}

export async function consumeCrmOAuthState(state: string): Promise<PendingCrmOAuth | null> {
  const { data, error } = await supabase
    .from("oauth_states")
    .select("user_id, code_verifier, created_at")
    .eq("state", state)
    .eq("provider", CRM_OAUTH_PROVIDER)
    .maybeSingle();

  if (error) {
    console.error("[CRM OAuth] State lookup failed:", error.message);
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
export async function pruneExpiredCrmOAuthStates(): Promise<void> {
  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  await supabase
    .from("oauth_states")
    .delete()
    .eq("provider", CRM_OAUTH_PROVIDER)
    .lt("created_at", cutoff);
}
