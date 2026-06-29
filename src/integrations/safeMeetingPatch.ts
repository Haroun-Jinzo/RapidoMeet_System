import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Applies a meetings row patch, dropping columns PostgREST reports as missing.
 * Lets persistMeetingResults work on older remote schemas without aborting child-table writes.
 */
export async function safeMeetingPatch(
  supabase: SupabaseClient,
  meetingId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  let remaining = { ...patch };

  for (let attempt = 0; attempt < 8 && Object.keys(remaining).length > 0; attempt++) {
    const { error } = await supabase
      .from("meetings")
      .update(remaining)
      .eq("id", meetingId)
      .eq("user_id", userId);

    if (!error) {
      return { ok: true };
    }

    const missing = extractMissingColumn(error.message);
    if (!missing || !(missing in remaining)) {
      return { ok: false, error: error.message };
    }

    console.warn(`[Persist] meetings.${missing} missing — retrying without it`);
    const { [missing]: _removed, ...next } = remaining;
    remaining = next;
  }

  return { ok: Object.keys(remaining).length === 0 };
}

function extractMissingColumn(message: string): string | null {
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] ?? null;
}
