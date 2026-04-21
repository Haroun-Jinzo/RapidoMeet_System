// src/utils/KeyResolver.ts
import { createClient } from "@supabase/supabase-js";

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

export class KeyResolver {
  /**
   * Fetches user custom keys from Supabase 'user_settings' and falls back to process.env
   */
  static async resolveKeys(userId: string): Promise<APIKeys> {
    try {
    console.log(`[KeyResolver] Attempting to fetch keys for user ID: ${userId}`);
      const { data, error } = await supabase
        .from("user_settings")
        .select("settings_value")
        .eq("user_id", userId)
        .eq("settings_key", "external_apis")
        .maybeSingle(); // Changed from .single() to avoid errors when 0 rows exist
        
    // --- DEBUG LOGS ---
      if (error) {
         console.warn(`[KeyResolver] Supabase query returned an error (might be expected if no keys saved yet):`, error.message);
      } else if (data && data.settings_value) {
         console.log(`[KeyResolver] SUCCESS! Pulled keys from Supabase:`, Object.keys(data.settings_value));
      } else {
         console.log(`[KeyResolver] Query succeeded but no settings_value found.`);
      }
      // ----------------------------

      const userKeys = (data?.settings_value || {}) as Record<string, string>;

      // Priority 1: User's custom key. Priority 2: Backend .env fallback
      return {
        Orchestrator: {
          provider: userKeys.llm_provider || 'gemini',
          apiKey: userKeys.llm_key || userKeys.gemini_api_key || process.env.GEMINI_API_KEY!
        },
        AudioTranscriber: {
          provider: userKeys.stt_provider || 'groq',
          apiKey: userKeys.stt_key || userKeys.groq_api_key || process.env.GROQ_API_KEY!
        },
        n8n: userKeys.automation_key || userKeys.n8n_key || userKeys.n8n_api_key || process.env.N8N_API_KEY!,
      };
    } catch (err) {
      console.warn(`[KeyResolver] Failed to fetch custom keys for ${userId}, using defaults.`);
      return {
        Orchestrator: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY! },
        AudioTranscriber: { provider: 'groq', apiKey: process.env.GROQ_API_KEY! },
        n8n: process.env.N8N_API_KEY!,
      };
    }
  }
}