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

export interface RapidoCRMCredentials {
  apiKey: string | null;
  apiUrl: string | null;
}

export interface APIKeys {
  Orchestrator: ServiceConfig;
  AudioTranscriber: ServiceConfig;
  n8n: string;
  rapidoCRM: RapidoCRMCredentials;
}

async function getDecryptedCredentials(userId: string, integrationId: string): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await supabase
      .from("user_connections")
      .select("credentials")
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .single();

    if (error || !data?.credentials) {
      console.warn(`[KeyResolver] No credentials found in user_connections for integration_id: ${integrationId}`);
      return null;
    }
    const creds = data.credentials as any;

    // If credentials were stored directly (legacy), return them
    if (!creds?.encrypted) {
      return creds;
    }

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
    const parsedCreds = JSON.parse(decrypted.toString("utf8"));
    return parsedCreds;
  } catch (e) {
    console.warn(`[KeyResolver] decrypt error for ${integrationId}:`, e);
    return null;
  }
}

// Control logging: set LOG_KEY_RESOLUTION=false to disable these non-sensitive logs
const LOG_KEY_RESOLUTION = process.env.LOG_KEY_RESOLUTION !== "false";

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function envKey(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeKey(value);
    if (normalized) return normalized;
  }
  return "";
}

// Simple UUID validator to avoid querying Postgres with non-UUID values
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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
          Orchestrator: { provider: "gemini", apiKey: envKey(process.env.GEMINI_API_KEY) },
          AudioTranscriber: { provider: "groq", apiKey: envKey(process.env.GROQ_API_KEY) },
          n8n: envKey(process.env.N8N_API_KEY),
          rapidoCRM: {
            apiKey: process.env.RAPIDOCRM_TEST_TOKEN || null,
            apiUrl: process.env.RAPIDOCRM_API_URL || null,
          },
        };
      }
      
      const { data, error } = await supabase
        .from("user_settings")
        .select("settings_value")
        .eq("user_id", userId)
        .eq("settings_key", "external_apis")
        .maybeSingle();

      if (error) console.warn("[KeyResolver] user_settings query error:", error.message);
      
      let userKeys: any = {};
      if (typeof data?.settings_value === "string") {
        try {
          userKeys = JSON.parse(data.settings_value);
        } catch (e) {
          console.warn("[KeyResolver] Failed to parse settings_value string");
        }
      } else {
        userKeys = data?.settings_value || {};
      }

      // Orchestrator (LLM)
      const llmProvider = userKeys.llm_provider || userKeys.llm?.provider || userKeys.Orchestrator?.provider || "gemini";

      // Priority 1: explicit llm_key in user_settings
      let orchestratorKey = envKey(
        userKeys.llm_key,
        userKeys[`${llmProvider}_api_key`],
        userKeys[`${llmProvider}_key`],
        userKeys.llm?.apiKey,
        userKeys.Orchestrator?.apiKey
      );

      if (!orchestratorKey) {
        let creds = await getDecryptedCredentials(userId, llmProvider);
        if (!creds) {
           creds = await getDecryptedCredentials(userId, "Orchestrator");
        }
        if (!creds) {
           creds = await getDecryptedCredentials(userId, "openai");
        }
        
        if (creds) {
          // try common key names
          orchestratorKey = envKey(
            creds.llm_key,
            creds.openai_api_key,
            creds.gemini_api_key,
            creds.claude_api_key,
            creds.api_key,
            creds.key,
            creds.apiKey
          );
        }
      }

      // fallback to env
      if (!orchestratorKey) {
        const envMap: Record<string, string> = {
          openai: process.env.OPENAI_API_KEY || "",
          gemini: process.env.GEMINI_API_KEY || "",
          claude: process.env.CLAUDE_API_KEY || "",
        };
        orchestratorKey = envKey(envMap[llmProvider], process.env.GEMINI_API_KEY);
      }

      // AudioTranscriber (STT)
      const sttProvider = userKeys.stt_provider || userKeys.stt?.provider || userKeys.AudioTranscriber?.provider || "groq";
      let sttKey = envKey(
        userKeys.stt_key,
        userKeys[`${sttProvider}_api_key`],
        userKeys[`${sttProvider}_key`],
        userKeys.stt?.apiKey,
        userKeys.AudioTranscriber?.apiKey
      );

      if (!sttKey) {
        const creds = await getDecryptedCredentials(userId, sttProvider);
        if (creds) {
          sttKey = envKey(
            creds.stt_key,
            creds.deepgram_api_key,
            creds.groq_api_key,
            creds.api_key,
            creds.key
          );
        }
      }

      if (!sttKey) {
        const envMap: Record<string, string> = {
          deepgram: process.env.DEEPGRAM_API_KEY || "",
          groq: process.env.GROQ_API_KEY || "",
        };
        sttKey = envKey(envMap[sttProvider], process.env.GROQ_API_KEY);
      }

      // n8n / automation
      let n8nKey = envKey(
        userKeys.automation_key,
        userKeys.n8n_key,
        userKeys.n8n_api_key,
        userKeys.n8n?.apiKey,
        userKeys.n8n
      );
      if (typeof userKeys.n8n === "object" && userKeys.n8n !== null) {
        n8nKey = envKey(n8nKey, userKeys.n8n.apiKey, userKeys.n8n.key);
      }
      
      if (!n8nKey) {
        const creds = await getDecryptedCredentials(userId, "n8n");
        if (creds) {
          n8nKey = envKey(creds.api_key, creds.n8n_key, creds.key);
        }
      }
      if (!n8nKey) n8nKey = envKey(process.env.N8N_API_KEY);

      // RapidoCRM — stored via Supabase connections-api in user_connections
      let rapidoCRMKey = envKey(userKeys.rapidocrm_api_key);
      let rapidoCRMUrl = envKey(userKeys.rapidocrm_api_url, userKeys.api_url);
      if (!rapidoCRMKey || !rapidoCRMUrl) {
        const creds = await getDecryptedCredentials(userId, "rapidocrm");
        if (creds) {
          rapidoCRMKey = envKey(
            rapidoCRMKey,
            creds.api_key,
            creds.rapidocrm_api_key,
            creds.key
          );
          rapidoCRMUrl = envKey(
            rapidoCRMUrl,
            creds.api_url,
            creds.rapidocrm_api_url
          );
        }
      }
      const rapidoCRM = {
        apiKey: rapidoCRMKey || envKey(process.env.RAPIDOCRM_TEST_TOKEN) || null,
        apiUrl: rapidoCRMUrl || envKey(process.env.RAPIDOCRM_API_URL) || null,
      };

      if (LOG_KEY_RESOLUTION) {
        const llmSummary = orchestratorKey ? `present(len=${(orchestratorKey || "").length})` : "missing";
        const sttSummary = sttKey ? `present(len=${(sttKey || "").length})` : "missing";
        const n8nSummary = n8nKey ? `present(len=${(n8nKey || "").length})` : "missing";
        const crmSummary = rapidoCRM.apiKey ? `present(len=${rapidoCRM.apiKey.length})` : "missing";
        const crmUrlSummary = rapidoCRM.apiUrl ? `present(len=${rapidoCRM.apiUrl.length})` : "missing";
        console.log(
          `[KeyResolver] Resolved keys for user ${userId}: llm=${llmProvider}(${llmSummary}), stt=${sttProvider}(${sttSummary}), n8n=${n8nSummary}, crm=${crmSummary}, crmUrl=${crmUrlSummary}`
        );

        // Print masked sample of the keys to aid debugging without leaking secrets
        const mask = (s?: string) => (s ? `${s.slice(0, 4)}...len=${s.length}` : "<missing>");
        console.log(
          `[KeyResolver] Masked keys samples -> llm: ${mask(orchestratorKey)}, stt: ${mask(sttKey)}, n8n: ${mask(n8nKey as string)}, crm: ${mask(rapidoCRM.apiKey ?? undefined)}, crmUrl: ${mask(rapidoCRM.apiUrl ?? undefined)}`
        );
      }

      return {
        Orchestrator: { provider: llmProvider, apiKey: envKey(orchestratorKey, process.env.GEMINI_API_KEY) },
        AudioTranscriber: { provider: sttProvider, apiKey: envKey(sttKey, process.env.GROQ_API_KEY) },
        n8n: envKey(n8nKey, process.env.N8N_API_KEY),
        rapidoCRM,
      };
    } catch (err) {
      console.warn(`[KeyResolver] Failed to fetch custom keys for ${userId}, using defaults.`, err);
      return {
        Orchestrator: { provider: "gemini", apiKey: envKey(process.env.GEMINI_API_KEY) },
        AudioTranscriber: { provider: "groq", apiKey: envKey(process.env.GROQ_API_KEY) },
        n8n: envKey(process.env.N8N_API_KEY),
        rapidoCRM: {
          apiKey: process.env.RAPIDOCRM_TEST_TOKEN || null,
          apiUrl: process.env.RAPIDOCRM_API_URL || null,
        },
      };
    }
  }
}