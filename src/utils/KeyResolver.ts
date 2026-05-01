// src/utils/KeyResolver.ts
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ServiceConfig {
  provider: string;
  apiKey: string;
}

export interface APIKeys {
  Orchestrator: ServiceConfig;
  AudioTranscriber: ServiceConfig;
  n8n: string;
}

async function getDecryptedCredentials(userId: string, integrationId: string): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await supabase
      .from("user_connections")
      .select("credentials")
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .single();

    if (error || !data?.credentials) return null;
    const creds = data.credentials as any;

    // If credentials were stored directly (legacy), return them
    if (!creds?.encrypted) return creds;

    const encryptedB64: string = creds.encrypted;
    const combined = Buffer.from(encryptedB64, "base64");
    if (combined.length < 13) return null;

    const iv = combined.slice(0, 12);
    const cipherWithTag = combined.slice(12);
    if (cipherWithTag.length < 16) return null;

    const authTag = cipherWithTag.slice(cipherWithTag.length - 16);
    const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - 16);

    const secret = process.env.ENCRYPTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const key = Buffer.from(secret.slice(0, 32).padEnd(32, "0"), "utf8");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch (e) {
    console.warn("[KeyResolver] decrypt error:", e);
    return null;
  }
}

export interface ResolvedProvider {
  provider: string;
  credentials: Record<string, any>;
}

export interface ResolvedExternalApis {
  llm?: ResolvedProvider;
  stt?: ResolvedProvider;
  n8n?: ResolvedProvider;
}

// Control logging: set LOG_KEY_RESOLUTION=false to disable these non-sensitive logs
const LOG_KEY_RESOLUTION = process.env.LOG_KEY_RESOLUTION !== "false";

function summarizeCreds(creds: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!creds || typeof creds !== "object") return out;
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === "string") out[k] = `len=${v.length}`;
    else if (Array.isArray(v)) out[k] = `array[len=${v.length}]`;
    else if (v && typeof v === "object") out[k] = "object";
    else out[k] = String(v);
  }
  return out;
}

// Simple UUID validator to avoid querying Postgres with non-UUID values
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Read `external_apis` user_settings for provider choices.
 */
export async function getProviderChoice(userId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings_value")
    .eq("user_id", userId)
    .eq("settings_key", "external_apis")
    .maybeSingle();

  if (error) console.warn("[KeyResolver] user_settings query error:", error.message);
  return (data?.settings_value || {}) as Record<string, any>;
}

/**
 * Preferred path: call Supabase Edge function to decrypt as the user.
 * Requires a user access token (Bearer).
 */
async function decryptViaEdge(provider: string, userAccessToken: string): Promise<Record<string, any>> {
  if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  const endpoint = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/encrypt-credentials`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ action: "decrypt", integrationId: provider }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Edge decrypt call failed (${res.status}) for provider ${provider}: ${txt}`);
  }

  const payloadRaw = await res.json().catch(() => null);
  const payload = payloadRaw && typeof payloadRaw === "object"
    ? (payloadRaw as Record<string, any>)
    : null;

  const creds =
    payload?.credentials ??
    payload?.result ??
    (payload?.data && (payload.data as Record<string, any>).credentials) ??
    payload;

  if (!creds || typeof creds !== "object") {
    throw new Error(`Edge decrypt returned no credentials for provider ${provider}`);
  }
  return creds;
}

/**
 * Main resolver: preferred edge-decrypt path when a user token is provided,
 * otherwise fallback to service-role read + local decrypt using getDecryptedCredentials.
 *
 * Throws clear errors when a provider is chosen but missing credentials.
 */
export async function resolveExternalApis(
  userId: string,
  opts?: { userAccessToken?: string }
): Promise<ResolvedExternalApis> {
  if (!userId) throw new Error("userId is required");

  const choices = await getProviderChoice(userId);

  const llmProvider: string | undefined =
    choices.llm_provider || choices.llm?.provider || choices.Orchestrator?.provider;
  const sttProvider: string | undefined =
    choices.stt_provider || choices.stt?.provider || choices.AudioTranscriber?.provider;
  const n8nProvider: string | undefined =
    choices.n8n_provider || choices.n8n?.provider || choices.n8n;

  if (LOG_KEY_RESOLUTION) {
    console.log(
      `[KeyResolver] Provider choices for user ${userId}: llm=${llmProvider || "none"}, stt=${sttProvider || "none"}, n8n=${n8nProvider || "none"}`
    );
  }

  const out: ResolvedExternalApis = {};

  async function resolveOne(kind: "llm" | "stt" | "n8n", provider?: string) {
    if (!provider) return;
    let creds: Record<string, any> | null = null;

    if (opts?.userAccessToken) {
      try {
        creds = await decryptViaEdge(provider, opts.userAccessToken);
      } catch (err) {
        throw new Error(`Failed to decrypt via edge for provider "${provider}": ${(err as Error).message}`);
      }
    } else {
      creds = await getDecryptedCredentials(userId, provider);
      if (!creds) {
        throw new Error(`No stored credentials found for provider "${provider}" (user: ${userId})`);
      }
    }

    if (!creds || typeof creds !== "object") {
      throw new Error(`Invalid credentials object for provider "${provider}"`);
    }

    if (LOG_KEY_RESOLUTION) {
      const source = opts?.userAccessToken ? "edge" : "service-role";
      const keys = Object.keys(creds || {});
      const summary = JSON.stringify(summarizeCreds(creds));
      console.log(
        `[KeyResolver] Resolved ${kind.toUpperCase()} → provider=${provider}, source=${source}, keys=[${keys.join(", ")}], summary=${summary}`
      );
    }

    if (kind === "llm") out.llm = { provider, credentials: creds };
    if (kind === "stt") out.stt = { provider, credentials: creds };
    if (kind === "n8n") out.n8n = { provider, credentials: creds };
  }

  await Promise.all([
    resolveOne("llm", llmProvider),
    resolveOne("stt", sttProvider),
    resolveOne("n8n", n8nProvider),
  ]);

  return out;
}

export class KeyResolver {
  static async resolveKeys(userId: string): Promise<APIKeys> {
    try {
      console.log(`[KeyResolver] Attempting to fetch keys for user ID: ${userId}`);
      // Short-circuit for internal or dev identifiers that are not UUIDs
      if (!isUuid(userId)) {
        if (LOG_KEY_RESOLUTION) {
          console.log(`[KeyResolver] Non-UUID userId \"${userId}\" — using env/service defaults.`);
        }
        return {
          Orchestrator: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY || "" },
          AudioTranscriber: { provider: "groq", apiKey: process.env.GROQ_API_KEY || "" },
          n8n: process.env.N8N_API_KEY || "",
        };
      }
      const { data, error } = await supabase
        .from("user_settings")
        .select("settings_value")
        .eq("user_id", userId)
        .eq("settings_key", "external_apis")
        .maybeSingle();

      if (error) console.warn("[KeyResolver] user_settings query error:", error.message);
      const userKeys = (data?.settings_value || {}) as Record<string, string>;

      // Orchestrator (LLM)
      const llmProvider = userKeys.llm_provider || "gemini";
      // Priority 1: explicit llm_key in user_settings
      let orchestratorKey = userKeys.llm_key
        || userKeys[`${llmProvider}_api_key`]
        || userKeys[`${llmProvider}_key`];

      if (!orchestratorKey) {
        const creds = await getDecryptedCredentials(userId, llmProvider);
        if (creds) {
          // try common key names
          orchestratorKey =
            creds.llm_key ||
            creds.openai_api_key ||
            creds.gemini_api_key ||
            creds.claude_api_key ||
            creds.api_key ||
            creds.key;
        }
      }

      // fallback to env
      if (!orchestratorKey) {
        const envMap: Record<string, string> = {
          openai: process.env.OPENAI_API_KEY || "",
          gemini: process.env.GEMINI_API_KEY || "",
          claude: process.env.CLAUDE_API_KEY || "",
        };
        orchestratorKey = envMap[llmProvider] || process.env.GEMINI_API_KEY || "";
      }

      // AudioTranscriber (STT)
      const sttProvider = userKeys.stt_provider || "groq";
      let sttKey = userKeys.stt_key
        || userKeys[`${sttProvider}_api_key`]
        || userKeys[`${sttProvider}_key`];

      if (!sttKey) {
        const creds = await getDecryptedCredentials(userId, sttProvider);
        if (creds) {
          sttKey =
            creds.stt_key ||
            creds.deepgram_api_key ||
            creds.groq_api_key ||
            creds.api_key ||
            creds.key;
        }
      }

      if (!sttKey) {
        const envMap: Record<string, string> = {
          deepgram: process.env.DEEPGRAM_API_KEY || "",
          groq: process.env.GROQ_API_KEY || "",
        };
        sttKey = envMap[sttProvider] || process.env.GROQ_API_KEY || "";
      }

      // n8n / automation
      let n8nKey = userKeys.automation_key || userKeys.n8n_key || userKeys.n8n_api_key;
      if (!n8nKey) {
        const creds = await getDecryptedCredentials(userId, "n8n");
        if (creds) {
          n8nKey = creds.api_key || creds.n8n_key || creds.key;
        }
      }
      if (!n8nKey) n8nKey = process.env.N8N_API_KEY || "";

      if (LOG_KEY_RESOLUTION) {
        const llmSummary = orchestratorKey ? `present(len=${(orchestratorKey || "").length})` : "missing";
        const sttSummary = sttKey ? `present(len=${(sttKey || "").length})` : "missing";
        const n8nSummary = n8nKey ? `present(len=${(n8nKey || "").length})` : "missing";
        console.log(
          `[KeyResolver] Resolved keys for user ${userId}: llm=${llmProvider}(${llmSummary}), stt=${sttProvider}(${sttSummary}), n8n=${n8nSummary}`
        );
      }

      return {
        Orchestrator: { provider: llmProvider, apiKey: orchestratorKey || "" },
        AudioTranscriber: { provider: sttProvider, apiKey: sttKey || "" },
        n8n: n8nKey || "",
      };
    } catch (err) {
      console.warn(`[KeyResolver] Failed to fetch custom keys for ${userId}, using defaults.`, err);
      return {
        Orchestrator: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY || "" },
        AudioTranscriber: { provider: "groq", apiKey: process.env.GROQ_API_KEY || "" },
        n8n: process.env.N8N_API_KEY || "",
      };
    }
  }
}