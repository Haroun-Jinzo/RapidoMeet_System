import { createClient } from "@supabase/supabase-js";
import {
  CONFIRMATION_SETTINGS_KEY,
  ConfirmationChannel,
  TELEGRAM_PROVIDER,
} from "../auth/telegramConfig";
import { connectionsStore } from "./ConnectionsStore";

const supabaseService = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ConfirmationPreferences {
  channel: ConfirmationChannel;
}

export async function getConfirmationPreferences(
  userId: string
): Promise<ConfirmationPreferences> {
  const { data } = await supabaseService
    .from("user_settings")
    .select("settings_value")
    .eq("user_id", userId)
    .eq("settings_key", CONFIRMATION_SETTINGS_KEY)
    .maybeSingle();

  const stored = (data?.settings_value ?? {}) as Partial<ConfirmationPreferences>;
  const hasTelegram = await connectionsStore.hasActiveConnection(userId, TELEGRAM_PROVIDER);

  if (!hasTelegram) {
    return { channel: "in_app" };
  }

  const channel = stored.channel;
  if (channel === "telegram" || channel === "both" || channel === "in_app") {
    return { channel };
  }

  return { channel: "both" };
}

export async function setConfirmationPreferences(
  userId: string,
  prefs: ConfirmationPreferences
): Promise<void> {
  const { error } = await supabaseService.from("user_settings").upsert(
    {
      user_id: userId,
      settings_key: CONFIRMATION_SETTINGS_KEY,
      settings_value: prefs,
    },
    { onConflict: "user_id,settings_key" }
  );

  if (error) {
    throw new Error(`Failed to save confirmation preferences: ${error.message}`);
  }
}

export function shouldSendTelegramConfirmation(
  prefs: ConfirmationPreferences,
  hasTelegram: boolean
): boolean {
  if (!hasTelegram) return false;
  return prefs.channel === "telegram" || prefs.channel === "both";
}
